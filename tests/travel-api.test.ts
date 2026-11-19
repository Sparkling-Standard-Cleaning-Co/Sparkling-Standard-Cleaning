import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/travel.ts';

function request(body: unknown): Request {
  return new Request('https://example.test/api/travel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('the public travel endpoint rejects the 0,0 missing-coordinate sentinel', async () => {
  const response = await onRequestPost({
    request: request({ lat: 0, lng: 0 }),
    env: { TRAVEL_ORIGIN: '30.4213,-87.2169' },
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid_request');
});

test('the public travel endpoint refuses to run from a 0,0 origin', async () => {
  const response = await onRequestPost({
    request: request({ lat: 30.683123, lng: -87.1968138 }),
    env: { TRAVEL_ORIGIN: '0,0' },
  });
  assert.equal(response.status, 503);
  const body = (await response.json()) as { ok: boolean; error: string };
  assert.equal(body.error, 'origin_not_configured');
});
