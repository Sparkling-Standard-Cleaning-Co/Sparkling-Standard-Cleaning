// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  pollDeviceCode,
  refreshAccessToken,
  startDeviceCode,
  uploadFile,
} from '../scripts/backup/lib/onedrive.mjs';
import { planRetention } from '../scripts/backup/lib/retention.mjs';

async function tempFile(bytes: number): Promise<string> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ss-onedrive-test-'));
  const file = path.join(directory, 'archive.ssbk');
  await fsp.writeFile(file, crypto.randomBytes(bytes));
  return file;
}

test('OneDrive device code and refresh requests stay delegated and token-safe', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchMock = async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: String(init.body ?? '') });
    if (String(url).includes('/devicecode')) {
      return new Response(JSON.stringify({
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
    }), { status: 200 });
  };
  const config = { clientId: 'synthetic-client-id', tenant: 'consumers', scope: 'offline_access Files.ReadWrite.AppFolder User.Read' };
  const device = await startDeviceCode(config, fetchMock as typeof fetch);
  assert.equal(device.user_code, 'ABCD-EFGH');
  assert.match(calls[0].body, /client_id=synthetic-client-id/);
  assert.match(calls[0].body, /Files.ReadWrite.AppFolder/);
  assert.equal(JSON.stringify(device).includes('access-token'), false);

  const refreshed = await refreshAccessToken(config, 'old-refresh-token', fetchMock as typeof fetch);
  assert.equal(refreshed.accessToken, 'access-token');
  assert.equal(refreshed.refreshToken, 'rotated-refresh-token');
  assert.match(calls[1].body, /grant_type=refresh_token/);
  assert.match(calls[1].body, /refresh_token=old-refresh-token/);
});

test('OneDrive uploads use the app-folder path and split large files into ranged chunks', async () => {
  const small = await tempFile(1024);
  const smallCalls: Array<{ url: string; auth: string; body: unknown }> = [];
  const smallResult = await uploadFile('access-token', 'Sparkling-Standard-Encrypted-Backups', small, 'small.ssbk', (async (url: string, init: RequestInit = {}) => {
    smallCalls.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization), body: init.body });
    return new Response(JSON.stringify({ id: 'small-item' }), { status: 200 });
  }) as typeof fetch);
  assert.equal(smallResult.size, 1024);
  assert.equal(smallCalls.length, 1);
  assert.match(smallCalls[0].url, /special\/approot:\/Sparkling-Standard-Encrypted-Backups\/small\.ssbk:\/content/);
  assert.equal(smallCalls[0].auth, 'Bearer access-token');
  assert.equal(String(smallCalls[0].url).includes('access-token'), false);

  const large = await tempFile(5 * 1024 * 1024 + 17);
  const ranges: string[] = [];
  let chunkIndex = 0;
  const largeResult = await uploadFile('access-token', 'Sparkling-Standard-Encrypted-Backups', large, 'large.ssbk', (async (url: string, init: RequestInit = {}) => {
    if (String(url).includes('createUploadSession')) {
      return new Response(JSON.stringify({ uploadUrl: 'https://upload.example/session' }), { status: 200 });
    }
    const headers = init.headers as Record<string, string>;
    ranges.push(String(headers['Content-Range'] ?? ''));
    chunkIndex += 1;
    if (chunkIndex === 1) return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ id: 'large-item' }), { status: 201 });
  }) as typeof fetch);
  assert.equal(largeResult.size, 5 * 1024 * 1024 + 17);
  assert.equal(ranges.length, 1);
  assert.match(ranges[0], /^bytes 0-/);
  assert.match(ranges[0], /5242897$/);
});

test('existing-folder mode uses the root path instead of the app folder', async () => {
  const file = await tempFile(512);
  let url = '';
  await uploadFile('access-token', 'Sparkling-Standard-Encrypted-Backups', file, 'existing.ssbk', (async (input: string) => {
    url = String(input);
    return new Response(JSON.stringify({ id: 'existing-item' }), { status: 200 });
  }) as typeof fetch, 'existing');
  assert.match(url, /\/me\/drive\/root:\/Sparkling-Standard-Encrypted-Backups\/existing\.ssbk:\/content$/);
});
test('retention groups an archive with its manifest and checksum as one recovery point', () => {
  const items = [
    { name: 'sparkling-standard-backup-2026-11-21T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-11-21T08-30-00.manifest.json.enc', bytes: 10 },
    { name: 'sparkling-standard-backup-2026-11-21T08-30-00.sha256', bytes: 1 },
    { name: 'sparkling-standard-backup-2026-11-20T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-11-20T08-30-00.manifest.json.enc', bytes: 10 },
    { name: 'sparkling-standard-backup-2026-11-20T08-30-00.sha256', bytes: 1 },
  ];
  const plan = planRetention(items, { daily: 1, weekly: 1, monthly: 1, capacityBytes: 5000 });
  assert.equal(plan.bundles, 2);
  assert.equal(plan.kept.length, 1);
  assert.equal(plan.delete.length, 1);
  assert.equal(plan.delete[0].id, 'sparkling-standard-backup-2026-11-20T08-30-00');
  assert.equal(plan.delete[0].files, 3);
});
test('retention keeps the newest archive and protected recovery points under the approved buckets', () => {
  const items = [
    { name: 'sparkling-standard-backup-2026-11-21T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-11-20T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-11-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-10-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-09-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-08-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-07-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-06-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-05-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-04-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-03-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-2026-02-01T08-30-00.ssbk', bytes: 100 },
    { name: 'sparkling-standard-backup-pre-migration-2026-01-01T08-30-00.ssbk', bytes: 100 },
  ];
  const plan = planRetention(items, {
    daily: 2,
    weekly: 2,
    monthly: 2,
    capacityBytes: 400,
    legalHold: ['sparkling-standard-backup-2026-10-01T08-30-00'],
  });
  assert.equal(plan.bundles, 13);
  assert.ok(plan.kept.some((bundle) => bundle.id.includes('2026-11-21')));
  assert.ok(plan.kept.some((bundle) => bundle.id.includes('pre-migration')));
  assert.ok(plan.kept.some((bundle) => bundle.id.includes('2026-10-01')));
  assert.equal(plan.delete.some((bundle) => bundle.id.includes('2026-11-21')), false);
  assert.equal(plan.capacityExceeded, true);
  assert.match(plan.warning ?? '', /exceeds/);
});
