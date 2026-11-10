// Shared request-delivery readiness contract.
//
// The static build cannot know whether the Cloudflare Pages Function has its
// server-side provider key. Readiness is therefore reported by GET /api/lead
// at runtime and this module decides whether the customer-facing warning is
// warranted. Public build-time values are only used for the static fallback.

export interface LeadReadinessChecks {
  owner_email: boolean;
  database: boolean;
  customer_email: boolean;
  turnstile: boolean;
  photo_storage: boolean;
}

export interface LeadReadiness {
  ok: true;
  ready: boolean;
  checks: LeadReadinessChecks;
  version: 2;
}

export type DeliveryStatus = 'ready' | 'direct' | 'unavailable' | 'unknown';

export function buildLeadReadiness(checks: LeadReadinessChecks): LeadReadiness {
  // Owner delivery is the authoritative requirement. D1 persistence, the
  // customer confirmation and photo storage are valuable but must never turn
  // a deliverable request into a falsely "disconnected" form.
  return { ok: true, ready: checks.owner_email, checks, version: 2 };
}

export function directFallbackAvailable(publicKey: string | undefined): boolean {
  return Boolean(publicKey?.trim());
}

/**
 * Resolve the customer-facing state.
 *
 * - `ready`       server relay can deliver the owner notification.
 * - `direct`      server unavailable, but a public provider key exists.
 * - `unavailable` the server explicitly reports no delivery path.
 * - `unknown`     a transient network/5xx problem; never claim delivery is
 *                 disconnected from an inconclusive probe.
 */
export function resolveDeliveryStatus(input: {
  serverReady: boolean | null;
  direct: boolean;
  probeFailed?: boolean;
}): DeliveryStatus {
  if (input.direct) return 'direct';
  if (input.serverReady === true) return 'ready';
  if (input.serverReady === false) return 'unavailable';
  if (input.probeFailed) return 'unknown';
  return 'unknown';
}
