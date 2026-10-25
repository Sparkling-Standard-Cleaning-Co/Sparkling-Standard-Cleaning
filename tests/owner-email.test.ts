// Owner notification email: real attachment splitting, Resend request shape,
// retries, idempotency and honest acceptance/partial/failure statuses.
// All provider calls are mocked; no email is sent.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OWNER_ATTACHMENT_BASE64_BUDGET,
  bytesToBase64,
  buildOwnerEmailMessages,
  describeOwnerEmailOutcome,
  ownerAttachmentFilename,
  sendOwnerEmailMessages,
  splitOwnerAttachments,
  type OwnerEmailAttachment,
} from '../src/lib/forms/owner-email.ts';

const attachment = (name: string, size = 6): OwnerEmailAttachment => ({
  filename: name,
  contentType: 'image/jpeg',
  contentBase64: 'A'.repeat(size),
  rawBytes: 4,
});

const notification = {
  'Contact - Name': 'Synthetic Customer',
  'Contact - Email': 'synthetic@example.com',
  'Photos - Attached': '2 private photos (metadata stripped)',
  'Photos - Private owner links': 'https://example.test/api/photo-view?key=x&sig=y',
};

test('base64 conversion and safe filenames never expose the original path', () => {
  assert.equal(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff])), Buffer.from([0xff, 0xd8, 0xff]).toString('base64'));
  assert.equal(ownerAttachmentFilename('SS-2026/10/ABC', 0, 'living_area', 'leads/x/a.jpg'), 'SS-2026-10-ABC_01_living_area.jpg');
  assert.match(ownerAttachmentFilename('', 5, 'a/b', 'leads/x/a.webp'), /^request_06_a-b\.webp$/);
});

test('attachments split by encoded size and parts share the same request id', () => {
  const parts = splitOwnerAttachments([attachment('a', 6), attachment('b', 6), attachment('c', 6)], 12);
  assert.deepEqual(parts.map((part) => part.length), [2, 1]);
  const messages = buildOwnerEmailMessages({
    notification,
    subject: 'Reservation request - $270 - 32503',
    requestId: 'SS-2026-10-ABC',
    attachments: [attachment('a', 6), attachment('b', 6), attachment('c', 6)],
    budget: 12,
    replyTo: 'synthetic@example.com',
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.attachments.length, 2);
  assert.equal(messages[1]?.attachments.length, 1);
  assert.match(messages[0]?.subject ?? '', /^\[Photos 1\/2\]/);
  assert.match(messages[1]?.subject ?? '', /^\[Photos 2\/2\]/);
  assert.match(messages[0]?.subject ?? '', /SS-2026-10-ABC/);
  assert.match(messages[0]?.html ?? '', /Attachment set 1 of 2/);
  assert.match(messages[0]?.text ?? '', /Private time-limited links/i);
  assert.equal(messages[0]?.replyTo, 'synthetic@example.com');
  assert.match(messages[0]?.idempotencyKey ?? '', /^owner-notification\/SS-2026-10-ABC\/part-1\/v1$/);
});

test('exactly two 8 MB photos fit in one part under the inbox-safe budget', () => {
  const eightMbBase64 = Math.ceil((8 * 1024 * 1024) / 3) * 4;
  const attachments = Array.from({ length: 6 }, (_, index) =>
    attachment(`photo-${index}.jpg`, eightMbBase64),
  );
  const parts = splitOwnerAttachments(attachments);
  assert.equal(parts.length, 3, 'six 8 MB files split into three inbox-safe emails');
  assert.equal(parts.every((part) => part.length === 2), true);
  assert.ok(parts.every((part) => part.reduce((sum, item) => sum + item.contentBase64.length, 0) <= OWNER_ATTACHMENT_BASE64_BUDGET));
});

test('sends a real attachment request with provider acceptance and an idempotency key', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'resend-email-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const messages = buildOwnerEmailMessages({
    notification,
    subject: 'Photo request',
    requestId: 'SS-2026-10-ABC',
    attachments: [attachment('SS-2026-10-ABC_01_kitchen.jpg')],
  });
  const outcome = await sendOwnerEmailMessages(messages, { RESEND_API_KEY: 'dummy-key' }, {
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(outcome.status, 'accepted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.resend.com/emails');
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer dummy-key');
  assert.match(headers['Idempotency-Key'] ?? '', /^owner-notification\/SS-2026-10-ABC\/part-1\/v1$/);
  const body = JSON.parse(String(calls[0]?.init?.body)) as {
    to: string[];
    attachments: Array<{ filename: string; content: string; content_type: string }>;
  };
  assert.deepEqual(body.to, ['owner@sparkling-standard.com']);
  assert.equal(body.attachments.length, 1);
  assert.equal(body.attachments[0]?.filename, 'SS-2026-10-ABC_01_kitchen.jpg');
  assert.equal(body.attachments[0]?.content, attachment('x').contentBase64);
  assert.equal(body.attachments[0]?.content_type, 'image/jpeg');
});

test('retries a retryable provider failure once with the same idempotency key', async () => {
  let calls = 0;
  const keys: string[] = [];
  const fetchImpl = async (_url: string | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    keys.push(String((init?.headers as Record<string, string>)['Idempotency-Key']));
    return calls === 1
      ? new Response('{}', { status: 500 })
      : new Response(JSON.stringify({ id: 'after-retry' }), { status: 200 });
  };
  const messages = buildOwnerEmailMessages({
    notification,
    subject: 'Photo request',
    requestId: 'retry/1',
    attachments: [attachment('photo.jpg')],
  });
  const outcome = await sendOwnerEmailMessages(messages, { RESEND_API_KEY: 'dummy-key' }, {
    fetchImpl: fetchImpl as typeof fetch,
    retryDelayMs: 0,
  });
  assert.equal(outcome.status, 'accepted');
  assert.equal(outcome.parts[0]?.attempts, 2);
  assert.equal(calls, 2);
  assert.equal(keys[0], keys[1]);
});

test('does not retry a non-retryable rejection and reports partial delivery honestly', async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return new Response('{}', { status: 422 });
  };
  const messages = buildOwnerEmailMessages({
    notification,
    subject: 'Photo request',
    requestId: 'bad/request',
    attachments: [attachment('a.jpg')],
  });
  const failed = await sendOwnerEmailMessages(messages, { RESEND_API_KEY: 'dummy-key' }, {
    fetchImpl: fetchImpl as typeof fetch,
    retryDelayMs: 0,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(calls, 1, '422 is not retried');

  let sequence = 0;
  const partialFetch = async (): Promise<Response> => {
    sequence += 1;
    return sequence === 1
      ? new Response(JSON.stringify({ id: 'one-accepted' }), { status: 200 })
      : new Response('{}', { status: 500 });
  };
  const twoParts = buildOwnerEmailMessages({
    notification,
    subject: 'Photo request',
    requestId: 'partial/1',
    attachments: [attachment('a', 8), attachment('b', 8), attachment('c', 8)],
    budget: 8,
  });
  const partial = await sendOwnerEmailMessages(twoParts, { RESEND_API_KEY: 'dummy-key' }, {
    fetchImpl: partialFetch as typeof fetch,
    retryDelayMs: 0,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.parts.filter((part) => part.status === 'accepted').length, 1);
  const log = describeOwnerEmailOutcome(partial);
  assert.match(log, /partial/);
  assert.doesNotMatch(log, /synthetic@example\.com|a\.jpg|photo-view/i);
});

test('reports not configured and no-attachment states without sending', async () => {
  const messages = buildOwnerEmailMessages({
    notification,
    subject: 'Photo request',
    requestId: 'none/1',
    attachments: [],
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.attachments.length, 0);
  const notConfigured = await sendOwnerEmailMessages(messages, {});
  assert.equal(notConfigured.status, 'not_configured');
  const noAttachments = await sendOwnerEmailMessages([], { RESEND_API_KEY: 'dummy-key' });
  assert.equal(noAttachments.status, 'no_attachments');
});
