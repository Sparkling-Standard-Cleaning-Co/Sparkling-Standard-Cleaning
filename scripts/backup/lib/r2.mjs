import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const REGION = 'auto';
const SERVICE = 's3';

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function signingKey(secret, date) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function encodePath(value) {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function canonicalQuery(query) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function r2Config(env = process.env) {
  const endpoint = env.BACKUP_R2_ENDPOINT?.trim().replace(/\/+$/, '');
  const bucket = env.BACKUP_R2_BUCKET?.trim();
  const accessKeyId = env.BACKUP_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.BACKUP_R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function requireR2Config(env = process.env) {
  const config = r2Config(env);
  if (!config) {
    throw new Error('R2 backup credentials are incomplete: BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY.');
  }
  return config;
}

export function buildSignedRequest(config, { method, key = '', query = {}, payloadHash, contentType = '', now = new Date() }) {
  const url = new URL(config.endpoint);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${encodeURIComponent(config.bucket)}${key ? `/${encodePath(key)}` : ''}`;
  const canonicalQuerystring = canonicalQuery(query);
  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(config.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const requestUrl = `${url.origin}${canonicalUri}${canonicalQuerystring ? `?${canonicalQuerystring}` : ''}`;
  return { url: requestUrl, headers, canonicalRequest, signature };
}

export async function listAllObjects(config, prefix = '', fetchImpl = fetch) {
  const objects = [];
  let continuationToken = '';
  do {
    const query = {
      'list-type': '2',
      'max-keys': '1000',
      ...(prefix ? { prefix } : {}),
      ...(continuationToken ? { 'continuation-token': continuationToken } : {}),
    };
    const signed = buildSignedRequest(config, {
      method: 'GET',
      query,
      payloadHash: crypto.createHash('sha256').update('').digest('hex'),
    });
    const response = await fetchImpl(signed.url, { method: 'GET', headers: signed.headers });
    if (!response.ok) {
      throw new Error(`R2 list failed: HTTP ${response.status}`);
    }
    const xml = await response.text();
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = match[1]?.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '';
      const size = Number(match[1]?.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] ?? 0);
      const lastModified = match[1]?.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? '';
      if (key) objects.push({ key: decodeXml(key), size, lastModified });
    }
    continuationToken = decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '');
  } while (continuationToken);
  return objects;
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export async function putFile(config, key, filePath, contentType = 'application/octet-stream', fetchImpl = fetch) {
  const stat = await fsp.stat(filePath);
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  const payloadHash = hash.digest('hex');
  const signed = buildSignedRequest(config, {
    method: 'PUT',
    key,
    payloadHash,
    contentType,
  });
  const response = await fetchImpl(signed.url, {
    method: 'PUT',
    headers: {
      ...signed.headers,
      'content-length': String(stat.size),
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  if (!response.ok) throw new Error(`R2 upload failed for ${key}: HTTP ${response.status}`);
  return { key, size: stat.size, sha256: payloadHash };
}

export async function getToFile(config, key, filePath, fetchImpl = fetch) {
  const signed = buildSignedRequest(config, {
    method: 'GET',
    key,
    payloadHash: crypto.createHash('sha256').update('').digest('hex'),
  });
  const response = await fetchImpl(signed.url, { method: 'GET', headers: signed.headers });
  if (!response.ok) throw new Error(`R2 download failed for ${key}: HTTP ${response.status}`);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await pipeline(response.body, fs.createWriteStream(filePath, { mode: 0o600 }));
  return { key, filePath };
}

export async function downloadPrefix(config, prefix, outDir, fetchImpl = fetch) {
  const objects = await listAllObjects(config, prefix, fetchImpl);
  const downloaded = [];
  for (const object of objects) {
    const relative = object.key.startsWith(prefix) ? object.key.slice(prefix.length).replace(/^\/+/, '') : object.key;
    const target = path.resolve(outDir, relative);
    if (!target.startsWith(path.resolve(outDir) + path.sep)) {
      throw new Error(`Refusing unsafe R2 object key: ${object.key}`);
    }
    await getToFile(config, object.key, target, fetchImpl);
    downloaded.push({ key: object.key, size: object.size, filePath: target });
  }
  return downloaded;
}

export async function deleteObject(config, key, fetchImpl = fetch) {
  const signed = buildSignedRequest(config, {
    method: 'DELETE',
    key,
    payloadHash: crypto.createHash('sha256').update('').digest('hex'),
  });
  const response = await fetchImpl(signed.url, { method: 'DELETE', headers: signed.headers });
  if (!response.ok && response.status !== 204) throw new Error(`R2 delete failed for ${key}: HTTP ${response.status}`);
  return { key, deleted: true };
}