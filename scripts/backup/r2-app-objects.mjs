#!/usr/bin/env node
// Download application R2 objects for encryption/off-site backup.
//
// Prefers the owner backup Worker, which reads application R2 through bucket
// bindings. The direct Cloudflare REST path remains as a fallback. It never
// prints object contents or a token.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   node scripts/backup/r2-app-objects.mjs --out backup-out/r2-app

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const token = (process.env.R2_APP_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN)?.trim();
const account = (process.env.R2_APP_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID)?.trim();
const controlUrl = (process.env.BACKUP_CONTROL_URL || '').trim().replace(/\/+$/, '');
const controlToken = (process.env.BACKUP_CONTROL_TOKEN || '').trim();
const useWorker = Boolean(controlUrl && controlToken);
const buckets = (process.env.APP_R2_BUCKETS || 'sparkling-standard-documents,sparkling-standard-lead-photos')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const out = path.resolve(arg('--out', 'backup-out/r2-app'));

if (!useWorker && (!token || !account)) {
  console.error('Backup control Worker or R2_APP_API_TOKEN plus R2_APP_ACCOUNT_ID is required.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${token}` };
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;

async function listObjects(bucket) {
  const objects = [];
  let cursor = '';
  do {
    const url = new URL(`${base}/${encodeURIComponent(bucket)}/objects`);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`list ${bucket}: HTTP ${response.status}`);
    const body = await response.json();
    if (!body.success) throw new Error(`list ${bucket}: ${body.errors?.[0]?.message || 'failed'}`);
    const page = body.result ?? [];
    objects.push(...page);
    cursor = body.result_info?.cursor ?? '';
  } while (cursor);
  return objects;
}

async function download(bucket, key, destination) {
  const url = `${base}/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`get ${bucket}/${key}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return {
    key,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

await fs.mkdir(out, { recursive: true });
const manifest = { createdAt: new Date().toISOString(), buckets: {}, files: [] };
for (const bucket of buckets) {
  const objects = await listObjects(bucket);
  manifest.buckets[bucket] = { count: objects.length };
  for (const object of objects) {
    if (!object.key) continue;
    const safe = object.key.split('/').map((part) => part.replace(/[^A-Za-z0-9._-]/g, '_')).join('/');
    const destination = path.join(out, bucket, safe);
    const result = await download(bucket, object.key, destination);
    manifest.files.push({ bucket, ...result, path: path.relative(out, destination).replaceAll('\\', '/') });
  }
  console.log(`${bucket}: ${objects.length} object(s)`);
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Downloaded ${manifest.files.length} object(s) to ${out}`);

