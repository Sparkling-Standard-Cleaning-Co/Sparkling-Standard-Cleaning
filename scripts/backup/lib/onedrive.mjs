// Microsoft Graph OneDrive client for encrypted backup archives.
//
// Delegated public-client flow only. This module never uses a client secret,
// never assumes Microsoft 365 Business, and defaults to the OneDrive app folder
// (Files.ReadWrite.AppFolder) so the token cannot read unrelated personal files.
// The owner may opt into the broader Files.ReadWrite scope explicitly.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_TENANT = 'consumers';
export const DEFAULT_SCOPE = 'offline_access Files.ReadWrite.AppFolder User.Read';
export const DEFAULT_FOLDER = 'Sparkling-Standard-Encrypted-Backups';
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

export function graphConfig(env = process.env) {
  const clientId = env.ONEDRIVE_CLIENT_ID?.trim() ?? '';
  const tenant = (env.ONEDRIVE_TENANT?.trim() || DEFAULT_TENANT).replace(/[^A-Za-z0-9.-]/g, '');
  const scope = env.ONEDRIVE_SCOPE?.trim() || DEFAULT_SCOPE;
  if (!clientId) return null;
  return { clientId, tenant, scope };
}

export function requireGraphConfig(env = process.env) {
  const config = graphConfig(env);
  if (!config) throw new Error('ONEDRIVE_CLIENT_ID is required for OneDrive backups.');
  return config;
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

export function tokenEndpoint(config) {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`;
}

export function deviceCodeEndpoint(config) {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/devicecode`;
}

export function graphUrl(pathname) {
  return `https://graph.microsoft.com/v1.0${pathname}`;
}

export function encodeGraphPath(remotePath) {
  const normalized = String(remotePath).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('OneDrive path is unsafe.');
  }
  return normalized.split('/').map(encodeURIComponent).join('/');
}

export async function startDeviceCode(config, fetchImpl = fetch) {
  const response = await fetchImpl(deviceCodeEndpoint(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: config.clientId, scope: config.scope }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OneDrive device authorization failed: ${payload.error_description || payload.error || response.status}`);
  }
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error('OneDrive device authorization response was incomplete.');
  }
  return payload;
}

export async function pollDeviceCode(config, deviceCode, fetchImpl = fetch, options = {}) {
  const intervalMs = Math.max(Number(options.intervalSeconds ?? 5), 2) * 1000;
  const deadline = Date.now() + Math.max(Number(options.expiresInSeconds ?? 900), 60) * 1000;
  while (Date.now() < deadline) {
    const response = await fetchImpl(tokenEndpoint(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: config.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.access_token) {
      return {
        accessToken: String(payload.access_token),
        refreshToken: payload.refresh_token ? String(payload.refresh_token) : '',
        expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
      };
    }
    if (payload.error === 'authorization_pending') {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    if (payload.error === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, intervalMs + 2000));
      continue;
    }
    if (payload.error === 'authorization_declined' || payload.error === 'expired_token') {
      throw new Error(`OneDrive authorization was not completed: ${payload.error}`);
    }
    throw new Error(`OneDrive token exchange failed: ${payload.error_description || payload.error || response.status}`);
  }
  throw new Error('OneDrive device authorization expired before approval.');
}

export async function refreshAccessToken(config, refreshToken, fetchImpl = fetch) {
  if (!refreshToken) throw new Error('ONEDRIVE_REFRESH_TOKEN is required (run the OneDrive auth command).');
  const response = await fetchImpl(tokenEndpoint(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: config.scope,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const code = payload.error || `http_${response.status}`;
    throw new Error(`OneDrive token refresh failed: ${code}. Reauthorize the backup account.`);
  }
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : refreshToken,
    expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
  };
}

function cachePath(env = process.env) {
  return env.ONEDRIVE_TOKEN_CACHE?.trim() || path.join(
    env.USERPROFILE || env.HOME || process.cwd(),
    '.config',
    'sparkling-standard',
    'onedrive-token.dpapi',
  );
}

export function isDpapiAvailable() {
  return process.platform === 'win32';
}

function protectWithDpapi(value) {
  const script = [
    '$v = [Console]::In.ReadToEnd();',
    '$secure = ConvertTo-SecureString -String $v -AsPlainText -Force;',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: value,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Windows DPAPI protection failed.');
  return result.stdout.trim();
}

function unprotectWithDpapi(value) {
  const script = [
    '$v = [Console]::In.ReadToEnd();',
    '$secure = ConvertTo-SecureString -String $v;',
    '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: value,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Windows DPAPI unprotect failed.');
  return result.stdout.trim();
}

export async function readTokenCache(env = process.env) {
  const file = cachePath(env);
  const raw = await fsp.readFile(file, 'utf8').catch(() => '');
  if (!raw.trim()) return null;
  const plaintext = isDpapiAvailable() ? unprotectWithDpapi(raw.trim()) : raw;
  try {
    const parsed = JSON.parse(plaintext);
    return parsed && typeof parsed.refreshToken === 'string' ? parsed : null;
  } catch {
    throw new Error('OneDrive token cache is unreadable. Reauthorize the backup account.');
  }
}

export async function writeTokenCache(cache, env = process.env) {
  const file = cachePath(env);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const plaintext = JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    refreshToken: cache.refreshToken,
    clientId: cache.clientId ?? null,
    tenant: cache.tenant ?? DEFAULT_TENANT,
    scope: cache.scope ?? DEFAULT_SCOPE,
    account: cache.account ?? null,
  });
  const protectedValue = isDpapiAvailable() ? protectWithDpapi(plaintext) : plaintext;
  await fsp.writeFile(file, protectedValue, { mode: 0o600 });
  if (!isDpapiAvailable()) await fsp.chmod(file, 0o600).catch(() => undefined);
  return file;
}

export async function accessTokenFromEnvironment(env = process.env, fetchImpl = fetch) {
  const direct = env.ONEDRIVE_ACCESS_TOKEN?.trim();
  if (direct) return { accessToken: direct, refreshToken: env.ONEDRIVE_REFRESH_TOKEN?.trim() || '', expiresAt: null, source: 'access_token' };
  const cached = await readTokenCache(env).catch(() => null);
  const configured = graphConfig(env);
  const config = configured ?? (cached?.clientId
    ? {
        clientId: cached.clientId,
        tenant: cached.tenant || DEFAULT_TENANT,
        scope: cached.scope || DEFAULT_SCOPE,
      }
    : null);
  if (!config) throw new Error('ONEDRIVE_CLIENT_ID is required for OneDrive backups.');
  const refreshToken = env.ONEDRIVE_REFRESH_TOKEN?.trim() || cached?.refreshToken || '';
  if (!refreshToken) {
    throw new Error('OneDrive is not authorized. Run `npm run backup:onedrive -- auth` once on the owner computer.');
  }
  const renewed = await refreshAccessToken(config, refreshToken, fetchImpl);
  if (cached && renewed.refreshToken && renewed.refreshToken !== refreshToken) {
    await writeTokenCache({ ...cached, refreshToken: renewed.refreshToken }, env).catch(() => undefined);
  }
  return { ...renewed, source: 'refresh_token' };
}

async function graphRequest(accessToken, pathname, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(graphUrl(pathname), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = payload?.error?.code || `http_${response.status}`;
    const message = payload?.error?.message || 'OneDrive request failed';
    throw new Error(`OneDrive ${pathname.split('?')[0]} failed: ${code}: ${message}`);
  }
  return response;
}

export async function getAppRoot(accessToken, fetchImpl = fetch) {
  const response = await graphRequest(accessToken, '/me/drive/special/approot', {}, fetchImpl);
  return response.json();
}

export async function getDriveQuota(accessToken, fetchImpl = fetch) {
  const response = await graphRequest(accessToken, '/me/drive?$select=quota', {}, fetchImpl);
  const drive = await response.json();
  const quota = drive?.quota ?? {};
  return {
    totalBytes: Number(quota.total ?? 0),
    usedBytes: Number(quota.used ?? 0),
    remainingBytes: Number(quota.remaining ?? 0),
    state: String(quota.state ?? 'unknown'),
  };
}

async function listChildrenByItem(accessToken, itemId, fetchImpl = fetch) {
  const items = [];
  let next = `/me/drive/items/${encodeURIComponent(itemId)}/children?$top=200`;
  while (next) {
    const response = await graphRequest(accessToken, next, {}, fetchImpl);
    const payload = await response.json();
    for (const item of payload.value ?? []) {
      items.push({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        size: Number(item.size ?? 0),
        folder: Boolean(item.folder),
        file: Boolean(item.file),
        createdAt: item.createdDateTime ?? '',
        modifiedAt: item.lastModifiedDateTime ?? '',
        webUrl: item.webUrl ?? '',
      });
    }
    next = payload['@odata.nextLink'] ? new URL(payload['@odata.nextLink']).pathname + new URL(payload['@odata.nextLink']).search : '';
  }
  return items;
}

export async function ensureFolder(accessToken, folderName = DEFAULT_FOLDER, fetchImpl = fetch) {
  const root = await getAppRoot(accessToken, fetchImpl);
  const children = await listChildrenByItem(accessToken, root.id, fetchImpl);
  const existing = children.find((item) => item.folder && item.name === folderName);
  if (existing) return existing;
  const response = await graphRequest(
    accessToken,
    `/me/drive/items/${encodeURIComponent(root.id)}/children`,
    {
      method: 'POST',
      body: JSON.stringify({ name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    },
    fetchImpl,
  );
  const item = await response.json();
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? folderName),
    size: Number(item.size ?? 0),
    folder: true,
    file: false,
    createdAt: item.createdDateTime ?? '',
    modifiedAt: item.lastModifiedDateTime ?? '',
    webUrl: item.webUrl ?? '',
  };
}

export async function listBackupFolder(accessToken, folderName = DEFAULT_FOLDER, fetchImpl = fetch) {
  const folder = await ensureFolder(accessToken, folderName, fetchImpl);
  return listChildrenByItem(accessToken, folder.id, fetchImpl);
}

export function remotePath(folderName, name) {
  return `${encodeGraphPath(folderName)}/${encodeGraphPath(name)}`;
}

export async function uploadSmallFile(accessToken, folderName, localPath, name, fetchImpl = fetch) {
  const bytes = await fsp.readFile(localPath);
  const response = await graphRequest(
    accessToken,
    `/me/drive/special/approot:/${remotePath(folderName, name)}:/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
    fetchImpl,
  );
  const item = await response.json();
  return { id: String(item.id ?? ''), name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export async function uploadLargeFile(accessToken, folderName, localPath, name, fetchImpl = fetch) {
  const stat = await fsp.stat(localPath);
  const sessionResponse = await graphRequest(
    accessToken,
    `/me/drive/special/approot:/${remotePath(folderName, name)}:/createUploadSession`,
    {
      method: 'POST',
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    },
    fetchImpl,
  );
  const session = await sessionResponse.json();
  if (!session.uploadUrl) throw new Error('OneDrive did not return an upload session URL.');
  const handle = await fsp.open(localPath, 'r');
  const hash = crypto.createHash('sha256');
  let finalItem = null;
  try {
    let offset = 0;
    while (offset < stat.size) {
      const length = Math.min(UPLOAD_CHUNK_BYTES, stat.size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      hash.update(buffer);
      const end = offset + length - 1;
      const response = await fetchImpl(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(length),
          'Content-Range': `bytes ${offset}-${end}/${stat.size}`,
        },
        body: buffer,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok && response.status !== 202) {
        throw new Error(`OneDrive upload session failed: HTTP ${response.status}`);
      }
      offset += length;
    }
    return {
      id: String(finalItem?.id ?? session.id ?? ''),
      name,
      size: stat.size,
      sha256: hash.digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

export async function uploadFile(accessToken, folderName, localPath, name, fetchImpl = fetch) {
  const stat = await fsp.stat(localPath);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Refusing to upload an empty or missing file: ${localPath}`);
  if (stat.size <= SIMPLE_UPLOAD_LIMIT) return uploadSmallFile(accessToken, folderName, localPath, name, fetchImpl);
  return uploadLargeFile(accessToken, folderName, localPath, name, fetchImpl);
}

export async function downloadFileByPath(accessToken, folderName, name, outPath, fetchImpl = fetch) {
  const response = await graphRequest(
    accessToken,
    `/me/drive/special/approot:/${remotePath(folderName, name)}:/content`,
    {},
    fetchImpl,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fsp.writeFile(outPath, bytes, { mode: 0o600 });
  return { path: path.resolve(outPath), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export async function getItemByPath(accessToken, folderName, name, fetchImpl = fetch) {
  const response = await graphRequest(
    accessToken,
    `/me/drive/special/approot:/${remotePath(folderName, name)}`,
    {},
    fetchImpl,
  );
  return response.json();
}

export async function deleteItemByPath(accessToken, folderName, name, fetchImpl = fetch) {
  const item = await getItemByPath(accessToken, folderName, name, fetchImpl);
  if (!item?.id) throw new Error(`OneDrive item not found: ${name}`);
  const response = await graphRequest(accessToken, `/me/drive/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, fetchImpl);
  return { deleted: true, id: String(item.id), name };
}

export function measureFolder(items) {
  const files = items.filter((item) => item.file);
  return {
    files: files.length,
    bytes: files.reduce((sum, item) => sum + Number(item.size || 0), 0),
  };
}
