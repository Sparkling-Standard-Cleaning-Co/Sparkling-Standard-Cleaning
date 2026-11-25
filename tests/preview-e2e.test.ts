import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  E2E_SESSION_COOKIE,
  E2E_TOKEN_HEADER,
  authorizeE2ERequest,
  constantTimeEqual,
  createE2ESession,
  e2eAllowedHosts,
  e2eConfigured,
  e2eSessionCookie,
  isE2EHost,
  readCookie,
  verifyE2ESession,
} from '../src/lib/env/preview-e2e.ts';
import { onRequest } from '../functions/_middleware.ts';
import { onRequestPost } from '../functions/api/e2e/session.ts';

const HOST = 'e2e-2026-11-22.sparkling-standard-cleaning.pages.dev';
const OTHER_PREVIEW = 'release-abc.sparkling-standard-cleaning.pages.dev';
const TOKEN = 'test-only-token-0123456789abcdef0123456789abcdef';
const ENV = { E2E_ALLOWED_HOSTS: HOST, E2E_AUTH_TOKEN: TOKEN };

test('the E2E allowlist accepts only exact, non-production pages.dev hosts', () => {
  assert.deepEqual(e2eAllowedHosts(`${HOST}, ${OTHER_PREVIEW}`), [HOST, OTHER_PREVIEW]);
  assert.deepEqual(e2eAllowedHosts('sparkling-standard.com,www.sparkling-standard.com'), []);
  assert.deepEqual(e2eAllowedHosts('*.pages.dev'), []);
  assert.equal(isE2EHost(HOST, ENV.E2E_ALLOWED_HOSTS), true);
  assert.equal(isE2EHost(OTHER_PREVIEW, ENV.E2E_ALLOWED_HOSTS), false);
  assert.equal(isE2EHost('sparkling-standard.com', ENV.E2E_ALLOWED_HOSTS), false);
  assert.equal(isE2EHost(HOST, undefined), false);
  assert.equal(e2eConfigured(ENV, HOST), true);
  assert.equal(e2eConfigured({ E2E_ALLOWED_HOSTS: HOST }, HOST), false);
  assert.equal(e2eConfigured(ENV, OTHER_PREVIEW), false);
});

test('session tokens are host-bound, expiring and tamper-evident', async () => {
  const now = Date.now();
  const session = await createE2ESession(TOKEN, HOST, now, 3600);
  assert.equal(await verifyE2ESession(TOKEN, HOST, session.value, now), true);
  assert.equal(await verifyE2ESession(TOKEN, OTHER_PREVIEW, session.value, now), false);
  assert.equal(await verifyE2ESession('different-secret', HOST, session.value, now), false);
  const tampered = `${session.value.slice(0, -1)}${session.value.endsWith('0') ? '1' : '0'}`;
  assert.equal(
    await verifyE2ESession(TOKEN, HOST, tampered, now),
    false,
  );
  assert.equal(
    await verifyE2ESession(TOKEN, HOST, session.value, now + 3_600_001),
    false,
  );
  assert.equal(await constantTimeEqual('same-value', 'same-value'), true);
  assert.equal(await constantTimeEqual('same-value', 'other-value'), false);
  assert.equal(readCookie(`a=1; ${E2E_SESSION_COOKIE}=${session.value}; b=2`, E2E_SESSION_COOKIE), session.value);
  assert.equal(readCookie('a=1', E2E_SESSION_COOKIE), '');
  assert.match(e2eSessionCookie(session), /HttpOnly/);
  assert.match(e2eSessionCookie(session), /SameSite=Lax/);
  assert.match(e2eSessionCookie(session), /Secure/);
});

test('E2E authorization requires the exact host and a valid header or cookie', async () => {
  const now = Date.now();
  const session = await createE2ESession(TOKEN, HOST, now, 3600);
  const base = {
    hostname: HOST,
    pathname: '/api/lead',
    method: 'POST',
    env: ENV,
    origin: `https://${HOST}`,
    now,
  };
  assert.equal(await authorizeE2ERequest({ ...base, tokenHeader: TOKEN }), 'header');
  assert.equal(await authorizeE2ERequest({ ...base, tokenHeader: 'wrong' }), null);
  assert.equal(
    await authorizeE2ERequest({ ...base, cookieHeader: `${E2E_SESSION_COOKIE}=${session.value}` }),
    'cookie',
  );
  assert.equal(await authorizeE2ERequest(base), null);
  assert.equal(
    await authorizeE2ERequest({
      ...base,
      hostname: OTHER_PREVIEW,
      tokenHeader: TOKEN,
    }),
    null,
  );
  assert.equal(
    await authorizeE2ERequest({
      ...base,
      pathname: '/api/estimate-checkout',
      origin: 'https://attacker.example',
      cookieHeader: `${E2E_SESSION_COOKIE}=${session.value}`,
    }),
    null,
  );
  assert.equal(
    await authorizeE2ERequest({
      ...base,
      origin: 'https://attacker.example',
      tokenHeader: TOKEN,
    }),
    'header',
  );
  assert.equal(
    await authorizeE2ERequest({
      ...base,
      hostname: HOST,
      pathname: '/api/stripe-webhook',
      env: { ...ENV, E2E_AUTH_TOKEN: '' },
      tokenHeader: '',
    }),
    null,
  );
});

async function middleware(
  url: string,
  env: Record<string, string>,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<{ status: number; body: string; headers: Headers }> {
  const request = new Request(url, { method, headers });
  const response = await onRequest({
    request,
    env,
    next: async () => new Response('next-ok', { status: 200 }),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

test('ordinary Preview hosts stay read-only', async () => {
  const response = await middleware(`https://${OTHER_PREVIEW}/api/lead`, ENV, {
    [E2E_TOKEN_HEADER]: TOKEN,
  }, 'POST');
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.body).error, 'preview_read_only');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
});

test('the configured exact E2E host can reach APIs only with valid authorization', async () => {
  const authorized = await middleware(`https://${HOST}/api/lead`, ENV, {
    [E2E_TOKEN_HEADER]: TOKEN,
  }, 'POST');
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body, 'next-ok');

  const denied = await middleware(`https://${HOST}/api/lead`, ENV, {
    [E2E_TOKEN_HEADER]: 'wrong-token',
  }, 'POST');
  assert.equal(denied.status, 503);
  assert.equal(JSON.parse(denied.body).error, 'preview_read_only');

  const noEnv = await middleware(`https://${HOST}/api/lead`, {}, {
    [E2E_TOKEN_HEADER]: TOKEN,
  }, 'POST');
  assert.equal(noEnv.status, 503);
});

test('the session exchange is limited to the exact configured host', async () => {
  const allowed = await middleware(`https://${HOST}/api/e2e/session`, ENV, {}, 'POST');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, 'next-ok');

  const blocked = await middleware(`https://${OTHER_PREVIEW}/api/e2e/session`, ENV, {}, 'POST');
  assert.equal(blocked.status, 503);
  assert.equal(JSON.parse(blocked.body).error, 'preview_read_only');
});

test('only the exact E2E host may reach the signed Stripe webhook', async () => {
  const allowed = await middleware(`https://${HOST}/api/stripe-webhook`, ENV, {}, 'POST');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, 'next-ok');

  const blocked = await middleware(`https://${OTHER_PREVIEW}/api/stripe-webhook`, ENV, {}, 'POST');
  assert.equal(blocked.status, 503);
});

test('production hosts never use the E2E exception', async () => {
  const response = await middleware(
    'https://sparkling-standard.com/api/lead',
    { ...ENV, E2E_ALLOWED_HOSTS: 'sparkling-standard.com' },
    { [E2E_TOKEN_HEADER]: TOKEN },
    'POST',
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, 'next-ok');
  assert.equal(response.headers.get('cache-control'), null);
});

test('the session endpoint rejects bad tokens, wrong origins and availability gaps', async () => {
  const url = `https://${HOST}/api/e2e/session`;
  const ok = await onRequestPost({
    request: new Request(url, {
      method: 'POST',
      headers: { [E2E_TOKEN_HEADER]: TOKEN, Origin: `https://${HOST}` },
    }),
    env: ENV,
  });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`^${E2E_SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const badToken = await onRequestPost({
    request: new Request(url, { method: 'POST', headers: { [E2E_TOKEN_HEADER]: 'wrong' } }),
    env: ENV,
  });
  assert.equal(badToken.status, 401);

  const badOrigin = await onRequestPost({
    request: new Request(url, {
      method: 'POST',
      headers: { [E2E_TOKEN_HEADER]: TOKEN, Origin: 'https://attacker.example' },
    }),
    env: ENV,
  });
  assert.equal(badOrigin.status, 403);

  const otherHost = await onRequestPost({
    request: new Request(`https://${OTHER_PREVIEW}/api/e2e/session`, {
      method: 'POST',
      headers: { [E2E_TOKEN_HEADER]: TOKEN },
    }),
    env: ENV,
  });
  assert.equal(otherHost.status, 404);

  const notConfigured = await onRequestPost({
    request: new Request(url, { method: 'POST', headers: { [E2E_TOKEN_HEADER]: TOKEN } }),
    env: {},
  });
  assert.equal(notConfigured.status, 404);
});

test('a signed session cookie authorizes the browser journey and rejects tampering', async () => {
  const now = Date.now();
  const session = await createE2ESession(TOKEN, HOST, now, 3600);
  const headers = {
    Cookie: `${E2E_SESSION_COOKIE}=${session.value}`,
    Origin: `https://${HOST}`,
  };
  const authorized = await middleware(`https://${HOST}/api/estimate-checkout`, ENV, headers, 'POST');
  assert.equal(authorized.status, 200);

  const tampered = await middleware(
    `https://${HOST}/api/estimate-checkout`,
    ENV,
    { ...headers, Cookie: `${E2E_SESSION_COOKIE}=${session.value.slice(0, -2)}00` },
    'POST',
  );
  assert.equal(tampered.status, 503);

  const expired = await createE2ESession(TOKEN, HOST, now - 5 * 60 * 60 * 1000, 3600);
  const expiredResponse = await middleware(
    `https://${HOST}/api/estimate-checkout`,
    ENV,
    { ...headers, Cookie: `${E2E_SESSION_COOKIE}=${expired.value}` },
    'POST',
  );
  assert.equal(expiredResponse.status, 503);
});
