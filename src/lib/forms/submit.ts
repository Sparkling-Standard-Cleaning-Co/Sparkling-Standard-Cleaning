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

export type SubmitOutcome =
  | { ok: true; via: 'relay' | 'provider'; verification?: LeadVerification }
  | { ok: false; reason: 'not_configured' | 'provider_error' | 'network_error' | 'server_error' | 'spam_rejected' };

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
  const payload = { subject, fields, turnstileToken: turnstileToken() };

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
    if (response.status === 503) {
      // The relay is deployed but its server key is not configured. It tells
      // the client to use the static fallback — do exactly that instead of
      // reporting a server error.
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (data.error !== 'not_configured') return { ok: false, reason: 'server_error' };
      // fall through to the direct provider path
    } else if (![404, 405, 501].includes(response.status)) {
      if (response.status === 400 || response.status === 422) return { ok: false, reason: 'spam_rejected' };
      return { ok: false, reason: 'server_error' };
    }
    // 404/405/501 → the function is not deployed here; fall through.
  } catch {
    // Network failure → fall through to the direct provider.
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
