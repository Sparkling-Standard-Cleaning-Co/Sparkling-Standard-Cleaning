// Lead submission adapter (client-side).
//
// Honesty rules (directive §24, §84, §21):
//  - Success is shown ONLY after the provider (or our serverless relay)
//    confirms receipt. A request is a REQUEST — never "confirmed booking".
//  - If nothing is configured or the provider fails, the customer gets an
//    honest message and a direct contact path — never a fake success.
//  - The serverless relay (/api/lead) is preferred when the site is deployed
//    with its Cloudflare functions; a direct provider submission is the
//    static fallback. The public Web3Forms key is client-safe by design.

import { business } from '../../config/business';
import type { AnalyticsEventName } from '../analytics/events';
import { track } from '../analytics/events';
import type { FailureReason } from './failure-copy';

export type SubmitOutcome =
  | { ok: true; via: 'relay' | 'provider'; verification?: LeadVerification }
  | { ok: false; reason: FailureReason };

/**
 * The server's verdict for a priced reservation. There is deliberately no
 * price here: the browser must never present an unverified price as accepted.
 */
export interface LeadVerification {
  status: 'verified' | 'preliminary' | 'mismatch' | 'unverifiable';
  travel_verified: boolean;
  travel_method: string;
  config_match: string;
}

function parseVerification(value: unknown): LeadVerification | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== 'verified' && status !== 'preliminary' && status !== 'mismatch' && status !== 'unverifiable') {
    return undefined;
  }
  return {
    status,
    travel_verified: record.travel_verified === true,
    travel_method: typeof record.travel_method === 'string' ? record.travel_method : 'none',
    config_match: typeof record.config_match === 'string' ? record.config_match : 'unknown',
  };
}

function turnstileToken(): string | undefined {
  const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return input?.value || undefined;
}

/** True only when the build configured a Turnstile site key. */
function turnstileConfigured(): boolean {
  return (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '') !== '';
}

/**
 * A Turnstile token is single-use and expires (~5 minutes). After any failed
 * attempt the widget is reset so the customer's retry receives a fresh token
 * instead of reusing a consumed/expired one.
 */
function resetTurnstile(): void {
  try {
    const widget = (window as unknown as { turnstile?: { reset?: () => void } }).turnstile;
    widget?.reset?.();
  } catch {
    // Best effort — the retry path still works with a fresh page load.
  }
}

/**
 * Waits briefly for the Turnstile widget to produce a token before sending.
 * Never bypasses verification: when a site key is configured but no token
 * appears, the submission is reported as a verification failure so the
 * customer can retry with honest copy.
 */
async function waitForTurnstileToken(timeoutMs = 10_000): Promise<string | undefined> {
  const existing = turnstileToken();
  if (existing) return existing;
  if (!turnstileConfigured()) return undefined;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const token = turnstileToken();
    if (token) return token;
  }
  return undefined;
}

/** Maps a relay error body/status to a distinct, actionable failure reason. */
function relayFailureReason(status: number, error: string): FailureReason {
  if (error === 'verification_failed') return 'verification_failed';
  if (error === 'spam_rejected' || status === 403) return 'spam_rejected';
  if (error === 'invalid_request' || status === 400 || status === 422) return 'invalid_request';
  return 'server_error';
}

/** Records a conversion honestly: fires now with consent, is replayed only
 *  once if the visitor later grants consent in the same session, and is
 *  dropped entirely after an explicit refusal. */
export function recordConversion<K extends AnalyticsEventName>(
  event: K,
  payload?: Record<string, unknown>,
): void {
  const consent = window.pccConsent;
  if (!consent) return;
  if (consent.granted()) {
    track(event, payload as never);
    return;
  }
  if (consent.choice() === null) {
    try {
      const raw = window.sessionStorage.getItem('pcc-lead-receipt');
      const queued = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
      const list = Array.isArray(queued) ? queued : [];
      if (!list.some((item) => item.event === event)) {
        list.push({ event, ...(payload ?? {}) });
      }
      window.sessionStorage.setItem('pcc-lead-receipt', JSON.stringify(list));
    } catch {
      // Storage failure only loses the deferred event — never the submission.
    }
  }
}

export async function submitLead(
  fields: Record<string, string>,
  subject: string,
): Promise<SubmitOutcome> {
  // A configured Turnstile widget must produce a token first; submitting
  // without one would just be rejected by the server and confuse the customer.
  const token = await waitForTurnstileToken();
  if (turnstileConfigured() && !token) {
    resetTurnstile();
    return { ok: false, reason: 'verification_failed' };
  }
  const payload = { subject, fields, turnstileToken: token };

  // 1) Preferred path: serverless relay with server-side validation and
  //    authoritative quote verification for priced reservations.
  try {
    const response = await fetch(business.forms.serverSubmitPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as { verification?: unknown };
      const verification = parseVerification(data.verification);
      return { ok: true, via: 'relay', ...(verification ? { verification } : {}) };
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    const error = typeof data.error === 'string' ? data.error : '';
    if (response.status === 503 && error === 'not_configured') {
      // The relay is deployed but its server key is not configured. It tells
      // the client to use the static fallback — do exactly that instead of
      // reporting a server error.
      // fall through to the direct provider path
    } else if ([404, 405, 501].includes(response.status)) {
      // The function is not deployed here; fall through to the direct provider.
    } else {
      // Distinguish real rejection causes so the customer gets honest,
      // actionable copy instead of a blanket "could not be verified".
      if (token) resetTurnstile();
      return { ok: false, reason: relayFailureReason(response.status, error) };
    }
  } catch {
    // Network failure → fall through to the direct provider.
    if (token) resetTurnstile();
  }

  // 2) Static fallback: direct provider submission with the public key. This
  //    path has no server to verify a quote, so it is labeled unmistakably for
  //    the owner (verification_path/status/note) and the customer copy stays
  //    request-only. The browser price is NEVER presented as a validated quote.
  if (!business.forms.web3formsAccessKey) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const response = await fetch(business.forms.web3formsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: business.forms.web3formsAccessKey,
        subject,
        botcheck: '',
        verification_path: 'direct_provider',
        verification_status: 'unverified_direct_submission',
        verification_note:
          'UNVERIFIED: submitted directly to the form provider — no authoritative server verification was available for this estimate.',
        submitted_at_client: new Date().toISOString(),
        ...fields,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (response.ok && data.success === true) return { ok: true, via: 'provider' };
    return { ok: false, reason: 'provider_error' };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}
