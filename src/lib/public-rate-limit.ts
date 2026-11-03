// Durable public-endpoint rate limits.
//
// Cloudflare may route successive requests to different isolates, so an
// in-memory Map is not an abuse control. This fixed-window counter lives in the
// existing D1 admin_rate_limits table and increments atomically with RETURNING.
// Identifiers are hashed; raw IP addresses and emails are never stored.

import type { D1Database } from './admin/d1.ts';
import { paymentHash } from './payments/ledger.ts';

export interface PublicRateLimitPolicy {
  limit: number;
  windowSeconds: number;
  blockSeconds: number;
}

export interface PublicRateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

export const PUBLIC_RATE_LIMITS = {
  leadIp: { limit: 12, windowSeconds: 600, blockSeconds: 900 },
  leadEmail: { limit: 6, windowSeconds: 3600, blockSeconds: 3600 },
  checkoutIp: { limit: 20, windowSeconds: 600, blockSeconds: 900 },
  holdIp: { limit: 20, windowSeconds: 60, blockSeconds: 300 },
  photoIp: { limit: 80, windowSeconds: 3600, blockSeconds: 1800 },
  geocodeIp: { limit: 120, windowSeconds: 60, blockSeconds: 300 },
  giftBalanceIp: { limit: 30, windowSeconds: 600, blockSeconds: 900 },
  giftCheckoutIp: { limit: 12, windowSeconds: 600, blockSeconds: 900 },
} as const satisfies Record<string, PublicRateLimitPolicy>;

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function rateKey(scope: string, identifier: string): Promise<string> {
  return `public:${scope}:${await paymentHash(identifier)}`;
}

export async function checkPublicRateLimit(
  db: D1Database | null | undefined,
  scope: string,
  identifier: string,
  policy: PublicRateLimitPolicy,
  now = new Date(),
): Promise<PublicRateLimitStatus> {
  if (!db) return { limited: false, retryAfterSeconds: 0 };
  try {
    const key = await rateKey(scope, identifier);
    const row = await db
      .prepare('SELECT attempts, window_started_at, blocked_until FROM admin_rate_limits WHERE scope_key = ? LIMIT 1')
      .bind(key)
      .first<{ attempts: number; window_started_at: string; blocked_until: string | null }>();
    if (!row) return { limited: false, retryAfterSeconds: 0 };
    const nowMs = now.getTime();
    if (row.blocked_until && Date.parse(row.blocked_until) > nowMs) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(row.blocked_until) - nowMs) / 1000)),
      };
    }
    const windowEnd = Date.parse(row.window_started_at) + policy.windowSeconds * 1000;
    if (nowMs >= windowEnd) return { limited: false, retryAfterSeconds: 0 };
    if (Number(row.attempts) >= policy.limit) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - nowMs) / 1000)),
      };
    }
    return { limited: false, retryAfterSeconds: 0 };
  } catch {
    return { limited: false, retryAfterSeconds: 0 };
  }
}

export async function consumePublicRateLimit(
  db: D1Database | null | undefined,
  scope: string,
  identifier: string,
  policy: PublicRateLimitPolicy,
  now = new Date(),
): Promise<PublicRateLimitStatus> {
  if (!db) return { limited: false, retryAfterSeconds: 0 };
  try {
    const key = await rateKey(scope, identifier);
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - policy.windowSeconds * 1000).toISOString();
    const blockUntil = new Date(now.getTime() + policy.blockSeconds * 1000).toISOString();
    await db
      .prepare(
        `INSERT OR IGNORE INTO admin_rate_limits
         (scope_key, attempts, window_started_at, blocked_until, updated_at)
         VALUES (?, 0, ?, NULL, ?)`,
      )
      .bind(key, nowIso, nowIso)
      .run();
    const row = await db
      .prepare(
        `UPDATE admin_rate_limits
         SET attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
             window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END,
             blocked_until = CASE
               WHEN (CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END) > ?
                 THEN ? ELSE NULL END,
             updated_at = ?
         WHERE scope_key = ?
         RETURNING attempts, window_started_at, blocked_until`,
      )
      .bind(cutoff, cutoff, nowIso, cutoff, policy.limit, blockUntil, nowIso, key)
      .first<{ attempts: number; window_started_at: string; blocked_until: string | null }>();
    if (!row) return { limited: false, retryAfterSeconds: 0 };
    if (row.blocked_until && Date.parse(row.blocked_until) > now.getTime()) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(row.blocked_until) - now.getTime()) / 1000)),
      };
    }
    return { limited: false, retryAfterSeconds: 0 };
  } catch {
    return { limited: false, retryAfterSeconds: 0 };
  }
}
