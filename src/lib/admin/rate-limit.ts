// Distributed authentication rate limiting.
//
// Cloudflare can route successive requests to different isolates, so an
// in-memory Map is not an effective abuse control. Counters live in the same
// durable ledger as the administrator account and use conditional writes so
// concurrent failures are counted atomically. Identifiers are hashed; raw IP
// addresses are never stored.

import {
  createLedgerJson,
  deleteLedgerKey,
  paymentHash,
  readLedgerJson,
  type LedgerBucket,
} from '../payments/ledger.ts';

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
  blockSeconds: number;
}

export interface RateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

interface RateLimitRecord {
  version: 1;
  count: number;
  windowStart: string;
  blockedUntil?: string;
}

export const AUTH_RATE_LIMITS = {
  loginIp: { limit: 5, windowSeconds: 900, blockSeconds: 900 },
  loginAccount: { limit: 20, windowSeconds: 900, blockSeconds: 900 },
  setupIp: { limit: 5, windowSeconds: 900, blockSeconds: 900 },
  recoveryIp: { limit: 5, windowSeconds: 900, blockSeconds: 900 },
  resetIp: { limit: 5, windowSeconds: 900, blockSeconds: 900 },
} as const satisfies Record<string, RateLimitPolicy>;

async function rateLimitKey(scope: string, identifier: string): Promise<string> {
  return `auth/rate/${scope}/${await paymentHash(identifier)}.json`;
}

function retryAfter(record: RateLimitRecord, now: number): number {
  if (!record.blockedUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(record.blockedUntil) - now) / 1000));
}

export async function rateLimitStatus(
  bucket: LedgerBucket,
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitStatus> {
  const key = await rateLimitKey(scope, identifier);
  const stored = await readLedgerJson<RateLimitRecord>(bucket, key).catch(() => null);
  if (!stored) return { limited: false, retryAfterSeconds: 0 };
  const nowMs = now.getTime();
  if (stored.value.blockedUntil && Date.parse(stored.value.blockedUntil) > nowMs) {
    return { limited: true, retryAfterSeconds: retryAfter(stored.value, nowMs) };
  }
  const windowEnd = Date.parse(stored.value.windowStart) + policy.windowSeconds * 1000;
  if (nowMs >= windowEnd) return { limited: false, retryAfterSeconds: 0 };
  return {
    limited: stored.value.count >= policy.limit,
    retryAfterSeconds:
      stored.value.count >= policy.limit
        ? Math.max(1, Math.ceil((windowEnd - nowMs) / 1000))
        : 0,
  };
}

export async function recordRateLimitFailure(
  bucket: LedgerBucket,
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitStatus> {
  const key = await rateLimitKey(scope, identifier);
  const nowMs = now.getTime();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stored = await readLedgerJson<RateLimitRecord>(bucket, key).catch(() => null);
    const current = stored?.value;
    const windowExpired =
      !current || nowMs >= Date.parse(current.windowStart) + policy.windowSeconds * 1000;
    const count = windowExpired ? 1 : current.count + 1;
    const blockedUntil =
      count >= policy.limit
        ? new Date(nowMs + policy.blockSeconds * 1000).toISOString()
        : current?.blockedUntil;
    const next: RateLimitRecord = {
      version: 1,
      count,
      windowStart: windowExpired ? now.toISOString() : current.windowStart,
      ...(blockedUntil ? { blockedUntil } : {}),
    };
    if (!stored) {
      const created = await createLedgerJson(bucket, key, next).catch(() => false);
      if (created) {
        return { limited: count >= policy.limit, retryAfterSeconds: count >= policy.limit ? policy.blockSeconds : 0 };
      }
      continue;
    }
    if (!stored.etag) {
      // Without a conditional write the counter cannot be updated safely.
      // Fail closed rather than pretending the failure was recorded.
      return { limited: true, retryAfterSeconds: policy.blockSeconds };
    }
    try {
      const result = await bucket.put(key, JSON.stringify(next), {
        onlyIf: new Headers({ 'If-Match': stored.etag }),
      });
      if (result !== null && result !== undefined) {
        return { limited: count >= policy.limit, retryAfterSeconds: count >= policy.limit ? policy.blockSeconds : 0 };
      }
    } catch {
      // Retry from a fresh read.
    }
  }
  // Persistent contention is indistinguishable from an active block, so fail
  // closed for this attempt.
  return { limited: true, retryAfterSeconds: policy.blockSeconds };
}

export async function clearRateLimit(
  bucket: LedgerBucket,
  scope: string,
  identifier: string,
): Promise<void> {
  await deleteLedgerKey(bucket, await rateLimitKey(scope, identifier)).catch(() => undefined);
}
