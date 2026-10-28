import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  AUTH_RATE_LIMITS,
  clearRateLimit,
  rateLimitStatus,
  recordRateLimitFailure,
} from '../src/lib/admin/rate-limit.ts';

const START = new Date('2026-10-28T12:00:00.000Z');

test('five failures block the identifier for the configured window', async () => {
  const bucket = new FakeLedger();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await recordRateLimitFailure(bucket, 'login:ip', '198.51.100.10', AUTH_RATE_LIMITS.loginIp, START);
    assert.equal(result.limited, attempt === 4);
  }
  const blocked = await rateLimitStatus(bucket, 'login:ip', '198.51.100.10', AUTH_RATE_LIMITS.loginIp, START);
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('concurrent failures are counted atomically across isolates', async () => {
  const bucket = new FakeLedger();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      recordRateLimitFailure(bucket, 'login:ip', '198.51.100.20', AUTH_RATE_LIMITS.loginIp, START),
    ),
  );
  const status = await rateLimitStatus(bucket, 'login:ip', '198.51.100.20', AUTH_RATE_LIMITS.loginIp, START);
  assert.equal(status.limited, true);
});

test('the window expires and a successful recovery clears the counter', async () => {
  const bucket = new FakeLedger();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await recordRateLimitFailure(bucket, 'reset:ip', '198.51.100.30', AUTH_RATE_LIMITS.resetIp, START);
  }
  const afterWindow = new Date(START.getTime() + (AUTH_RATE_LIMITS.resetIp.windowSeconds + 1) * 1000);
  assert.equal(
    (await rateLimitStatus(bucket, 'reset:ip', '198.51.100.30', AUTH_RATE_LIMITS.resetIp, afterWindow)).limited,
    false,
  );

  const second = new FakeLedger();
  await recordRateLimitFailure(second, 'reset:ip', '198.51.100.31', AUTH_RATE_LIMITS.resetIp, START);
  await clearRateLimit(second, 'reset:ip', '198.51.100.31');
  assert.equal(
    (await rateLimitStatus(second, 'reset:ip', '198.51.100.31', AUTH_RATE_LIMITS.resetIp, START)).limited,
    false,
  );
});

test('raw IP addresses are never stored in rate-limit keys', async () => {
  const bucket = new FakeLedger();
  await recordRateLimitFailure(bucket, 'login:ip', '203.0.113.77', AUTH_RATE_LIMITS.loginIp, START);
  assert.equal([...bucket.values.keys()].some((key) => key.includes('203.0.113.77')), false);
});
