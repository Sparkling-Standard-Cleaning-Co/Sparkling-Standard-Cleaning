import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_COOKIE,
  ADMIN_KEY,
  PASSWORD_HASH_ALGORITHM,
  PASSWORD_ITERATIONS,
  hashNeedsUpgrade,
  hashPassword,
  hashToken,
  readAdmin,
  sessionKey,
  verifyPassword,
  type AdminSession,
} from '../src/lib/admin/auth.ts';
import { onRequestGet as authGet, onRequestPost as authPost } from '../functions/api/gift-auth.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';

const SETUP_CODE = 'setup-code-for-tests-only';
const PASSWORD = 'Correct-Horse-9-Battery!';

function request(body: unknown, ip = '198.51.100.10', cookie = ''): Request {
  return new Request('https://example.test/api/gift-auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function sessionRequest(cookie: string): Request {
  return new Request('https://example.test/api/gift-auth', {
    headers: { Cookie: cookie },
  });
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${ADMIN_COOKIE}=([^;]+)`).exec(header);
  return match ? `${ADMIN_COOKIE}=${match[1]}` : '';
}

function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function withFetch<T>(
  stub: (url: string | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function createConfiguredAdmin(bucket: FakeLedger): Promise<{ cookie: string; session: Record<string, unknown>; emailBody: string }> {
  let sent = '';
  const response = await withFetch(
    async (url, init) => {
      if (String(url).includes('api.resend.com')) {
        sent = String(init?.body ?? '');
        return jsonResponse({ id: 'email_1' });
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    },
    () =>
      authPost({
        request: request({
          action: 'setup',
          setupCode: SETUP_CODE,
          password: PASSWORD,
          recoveryEmail: 'recovery@example.test',
        }, '198.51.100.11'),
        env: {
          PAYMENT_LEDGER: bucket,
          GIFT_ADMIN_SETUP_CODE: SETUP_CODE,
          RESEND_API_KEY: 'resend_test',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.ok, true);
  assert.equal(body.verificationSent, true);
  assert.match(sent, /recovery@example\.test/);
  return { cookie: cookieFrom(response), session: body.session as Record<string, unknown>, emailBody: sent };
}

test('password hashing stays inside the Cloudflare Workers PBKDF2 ceiling', async () => {
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  const requested: number[] = [];
  crypto.subtle.deriveBits = async (algorithm, key, length) => {
    if (algorithm.name === 'PBKDF2' && algorithm.iterations > 100_000) {
      throw new DOMException(
        'Pbkdf2 failed: iteration counts above 100000 are not supported',
        'NotSupportedError',
      );
    }
    requested.push(algorithm.iterations);
    return original(algorithm, key, length);
  };
  try {
    const hash = await hashPassword(PASSWORD);
    assert.deepEqual(requested, [PASSWORD_ITERATIONS]);
    assert.ok(PASSWORD_ITERATIONS <= 100_000);
    assert.ok(hash.startsWith(`${PASSWORD_HASH_ALGORITHM}$${PASSWORD_ITERATIONS}$`));
    assert.equal(await verifyPassword(PASSWORD, hash), true);
    assert.equal(await verifyPassword('wrong password', hash), false);
  } finally {
    crypto.subtle.deriveBits = original;
  }
});

test('legacy PBKDF2 hashes remain versioned and distinguishable from current hashes', async () => {
  const iterations = 210_000;
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PASSWORD),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  const legacy = `${PASSWORD_HASH_ALGORITHM}$${iterations}$${Buffer.from(salt).toString('base64url')}$${Buffer.from(bits).toString('base64url')}`;
  assert.equal(await verifyPassword(PASSWORD, legacy), true);
  assert.equal(hashNeedsUpgrade(legacy), true);
  assert.equal(hashNeedsUpgrade(`${PASSWORD_HASH_ALGORITHM}$${PASSWORD_ITERATIONS}$c2FsdA$aGFzaA`), false);
});

test('an unsupported password KDF returns a sanitized error and writes no admin', async () => {
  const bucket = new FakeLedger();
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  crypto.subtle.deriveBits = async () => {
    throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported', 'NotSupportedError');
  };
  try {
    const response = await authPost({
      request: request({
        action: 'setup',
        setupCode: SETUP_CODE,
        password: PASSWORD,
        recoveryEmail: 'recovery@example.test',
      }, '198.51.100.12'),
      env: { PAYMENT_LEDGER: bucket, GIFT_ADMIN_SETUP_CODE: SETUP_CODE },
    } as never);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'auth_crypto_unavailable' });
    assert.equal(await readAdmin(bucket), null);
  } finally {
    crypto.subtle.deriveBits = original;
  }
});

test('first-run setup hashes the password, sets a hardened cookie and never returns the hash', async () => {
  const bucket = new FakeLedger();
  const response = await withFetch(
    async () => jsonResponse({ id: 'email_1' }),
    () =>
      authPost({
        request: request({
          action: 'setup',
          setupCode: SETUP_CODE,
          password: PASSWORD,
          recoveryEmail: 'recovery@example.test',
        }),
        env: {
          PAYMENT_LEDGER: bucket,
          GIFT_ADMIN_SETUP_CODE: SETUP_CODE,
          RESEND_API_KEY: 'resend_test',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.doesNotMatch(raw, /Correct-Horse/);
  assert.doesNotMatch(raw, /pbkdf2-sha256/);
  const header = response.headers.get('set-cookie') ?? '';
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
  const admin = bucket.json<{ passwordHash: string; recoveryEmail: string }>(ADMIN_KEY);
  assert.ok(admin?.passwordHash.startsWith('pbkdf2-sha256$'));
  assert.notEqual(admin?.passwordHash, PASSWORD);
  assert.equal(admin?.recoveryEmail, 'recovery@example.test');
  assert.equal(await verifyPassword(PASSWORD, admin!.passwordHash), true);
  assert.equal(await verifyPassword('wrong password', admin!.passwordHash), false);
});

test('setup requires the private setup code and an existing admin cannot be overwritten', async () => {
  const bucket = new FakeLedger();
  const wrong = await authPost({
    request: request({ action: 'setup', setupCode: 'wrong-code', password: PASSWORD }),
    env: { PAYMENT_LEDGER: bucket, GIFT_ADMIN_SETUP_CODE: SETUP_CODE },
  } as never);
  assert.equal(wrong.status, 401);
  await createConfiguredAdmin(bucket);
  const second = await authPost({
    request: request({ action: 'setup', setupCode: SETUP_CODE, password: 'Another-Password-2!' }, '198.51.100.12'),
    env: { PAYMENT_LEDGER: bucket, GIFT_ADMIN_SETUP_CODE: SETUP_CODE },
  } as never);
  assert.equal(second.status, 409);
});

test('login is generic, rate-limited and creates a fresh session', async () => {
  const bucket = new FakeLedger();
  await createConfiguredAdmin(bucket);
  const wrong = await authPost({
    request: request({ action: 'login', password: 'Wrong-Password-9!' }, '198.51.100.20'),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(wrong.status, 401);
  const wrongBody = await wrong.text();
  assert.doesNotMatch(wrongBody, /user|account|email/i);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await authPost({
      request: request({ action: 'login', password: 'Wrong-Password-9!' }, '198.51.100.20'),
      env: { PAYMENT_LEDGER: bucket },
    } as never);
  }
  const blocked = await authPost({
    request: request({ action: 'login', password: 'Wrong-Password-9!' }, '198.51.100.20'),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(blocked.status, 429);

  const success = await authPost({
    request: request({ action: 'login', password: PASSWORD }, '198.51.100.21'),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(success.status, 200);
  const cookie = cookieFrom(success);
  assert.ok(cookie);
  const state = await authGet({ request: sessionRequest(cookie), env: { PAYMENT_LEDGER: bucket } } as never);
  assert.equal(state.status, 200);
  const stateBody = await json(state);
  assert.equal(stateBody.authenticated, true);
  assert.ok((stateBody.session as Record<string, unknown>).csrf);

  const logout = await authPost({
    request: request({ action: 'logout' }, '198.51.100.21', cookie),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(logout.status, 200);
  const after = await authGet({ request: sessionRequest(cookie), env: { PAYMENT_LEDGER: bucket } } as never);
  assert.equal((await json(after)).authenticated, false);
});

test('backup-email verification and recovery use one-time links and invalidate sessions', async () => {
  const bucket = new FakeLedger();
  const created = await createConfiguredAdmin(bucket);
  const emails: string[] = [created.emailBody];
  const stub = async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      emails.push(String(init?.body ?? ''));
      return jsonResponse({ id: 'email_ok' });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  };

  await withFetch(stub, async () => {
    const first = /https:\/\/sparkling-standard\.com\/gift-admin\/\?verify=([^\s"<\\]+)/.exec(emails[0] ?? '');
    assert.ok(first, 'verification link');
    const verify = await authPost({
      request: request({ action: 'verify-email', token: decodeURIComponent(first[1]!) }, '198.51.100.30'),
      env: { PAYMENT_LEDGER: bucket },
    } as never);
    assert.equal(verify.status, 200, await verify.clone().text());
    const admin = await readAdmin(bucket);
    assert.equal(admin?.recoveryEmailVerified, true);

    const recover = await authPost({
      request: request({ action: 'recover', channel: 'email' }, '198.51.100.30'),
      env: { PAYMENT_LEDGER: bucket, RESEND_API_KEY: 'resend_test' },
    } as never);
    assert.equal(recover.status, 200);
    const reset = /https:\/\/sparkling-standard\.com\/gift-admin\/\?reset=([^\s"<\\]+)/.exec(emails[1] ?? '');
    assert.ok(reset, 'reset link');
    const token = decodeURIComponent(reset[1]!);
    const resetResponse = await authPost({
      request: request({ action: 'reset', token, password: 'New-Correct-Horse-8!' }, '198.51.100.31'),
      env: { PAYMENT_LEDGER: bucket, RESEND_API_KEY: 'resend_test' },
    } as never);
    assert.equal(resetResponse.status, 200);
    assert.equal(await verifyPassword('New-Correct-Horse-8!', (await readAdmin(bucket))!.passwordHash), true);
    const replay = await authPost({
      request: request({ action: 'reset', token, password: 'Another-Correct-Horse-7!' }, '198.51.100.32'),
      env: { PAYMENT_LEDGER: bucket, RESEND_API_KEY: 'resend_test' },
    } as never);
    assert.equal(replay.status, 400);
  });

  const oldSession = await authGet({
    request: sessionRequest(created.cookie),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal((await json(oldSession)).authenticated, false);
  assert.equal(await verifyPassword(PASSWORD, (await readAdmin(bucket))!.passwordHash), false);
});

test('sessions expire and authenticated recovery changes require CSRF and reauthentication', async () => {
  const bucket = new FakeLedger();
  const created = await createConfiguredAdmin(bucket);
  const session = created.session as { csrf: string };
  const token = created.cookie.split('=')[1]!;
  const key = sessionKey(await hashToken(token));
  const stored = bucket.json<AdminSession>(key);
  assert.ok(stored);
  bucket.values.set(key, JSON.stringify({ ...stored, expiresAt: '2020-01-01T00:00:00.000Z' }));
  const expired = await authGet({ request: sessionRequest(created.cookie), env: { PAYMENT_LEDGER: bucket } } as never);
  assert.equal((await json(expired)).authenticated, false);

  // Create a fresh session through login for the authenticated action checks.
  const login = await authPost({
    request: request({ action: 'login', password: PASSWORD }, '198.51.100.40'),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  const cookie = cookieFrom(login);
  const csrf = ((await json(login)).session as { csrf: string }).csrf;
  const noCsrf = await authPost({
    request: request({ action: 'update-recovery', password: PASSWORD, recoveryEmail: 'new@example.test' }, '198.51.100.40', cookie),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(noCsrf.status, 403);
  const noReauth = await authPost({
    request: new Request('https://example.test/api/gift-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.40',
        Cookie: cookie,
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ action: 'update-recovery', password: 'Wrong-Password-1!', recoveryEmail: 'new@example.test' }),
    }),
    env: { PAYMENT_LEDGER: bucket },
  } as never);
  assert.equal(noReauth.status, 401);
});
