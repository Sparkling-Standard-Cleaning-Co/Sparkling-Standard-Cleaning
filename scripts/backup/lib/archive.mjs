import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encryptBuffer } from './crypto.mjs';

export const ARCHIVE_MAGIC = Buffer.from('SSBA1');
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = ARCHIVE_MAGIC.length + 1 + IV_BYTES;

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function listFiles(root, options = {}) {
  const excluded = new Set(options.exclude ?? []);
  const results = [];
  async function walk(directory, prefix) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.has(entry.name) || excluded.has(relative)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', '.astro', 'backup-out', 'legal-out'].includes(entry.name)) continue;
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        results.push({ absolute, path: relative.replaceAll('\\', '/') });
      }
    }
  }
  await walk(root, '');
  return results;
}

export async function inventory(root) {
  const files = await listFiles(root);
  let bytes = 0;
  const byExtension = new Map();
  for (const file of files) {
    const stat = await fsp.stat(file.absolute);
    bytes += stat.size;
    const extension = path.extname(file.path).toLowerCase() || '(none)';
    const current = byExtension.get(extension) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += stat.size;
    byExtension.set(extension, current);
  }
  return {
    root: path.resolve(root),
    files: files.length,
    bytes,
    byExtension: Object.fromEntries([...byExtension.entries()].sort((a, b) => b[1].bytes - a[1].bytes)),
  };
}

export async function writeEncryptedArchive({ entries, outPath, key, onProgress }) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = fs.createWriteStream(outPath, { mode: 0o600 });
  out.write(Buffer.concat([ARCHIVE_MAGIC, Buffer.from([VERSION]), iv]));
  const recorded = [];
  let bytes = 0;

  async function* source() {
    for (const entry of entries) {
      const stat = await fsp.stat(entry.absolute);
      if (!stat.isFile()) continue;
      const header = Buffer.from(JSON.stringify({ path: entry.path, size: stat.size }), 'utf8');
      const headerLength = Buffer.alloc(4);
      headerLength.writeUInt32BE(header.length, 0);
      yield headerLength;
      yield header;
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(entry.absolute)) {
        hash.update(chunk);
        bytes += chunk.length;
        yield chunk;
      }
      const digest = hash.digest();
      yield digest;
      recorded.push({ path: entry.path, size: stat.size, sha256: digest.toString('hex') });
      onProgress?.({ path: entry.path, size: stat.size, bytes, files: recorded.length });
    }
    const end = Buffer.alloc(4);
    end.writeUInt32BE(0, 0);
    yield end;
  }

  const tagger = new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk);
      callback();
    },
    flush(callback) {
      this.push(cipher.getAuthTag());
      callback();
    },
  });

  await pipeline(source(), cipher, tagger, out);
  const archiveSha256 = await sha256File(outPath);
  return { archivePath: outPath, archiveSha256, entries: recorded, plainBytes: bytes };
}

function safeTarget(outDir, entryPath) {
  const normalized = String(entryPath).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe archive path: ${entryPath}`);
  }
  const target = path.resolve(outDir, normalized);
  if (!target.startsWith(path.resolve(outDir) + path.sep)) {
    throw new Error(`Archive path escapes the output directory: ${entryPath}`);
  }
  return target;
}

export async function extractEncryptedArchive({ archivePath, outDir, key }) {
  const handle = await fsp.open(archivePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < HEADER_BYTES + TAG_BYTES) throw new Error('Archive is too short.');
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    if (header.subarray(0, ARCHIVE_MAGIC.length).toString('utf8') !== ARCHIVE_MAGIC.toString('utf8')) {
      throw new Error('Archive magic is invalid.');
    }
    if (header[ARCHIVE_MAGIC.length] !== VERSION) throw new Error('Archive version is not supported.');
    const iv = header.subarray(ARCHIVE_MAGIC.length + 1, HEADER_BYTES);
    const ciphertextStart = HEADER_BYTES;
    const ciphertextEnd = stat.size - TAG_BYTES - 1;
    if (ciphertextEnd < ciphertextStart) throw new Error('Archive has no encrypted content.');
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const source = fs.createReadStream(archivePath, { start: ciphertextStart, end: ciphertextEnd });

    await fsp.mkdir(outDir, { recursive: true });
    let pending = Buffer.alloc(0);
    let state = 'headerLength';
    let expectedHeaderLength = 0;
    let current = null;
    let stream = null;
    let remaining = 0;
    let hash = null;
    const extracted = [];

    async function writeToStream(chunk) {
      if (!stream) throw new Error('Archive stream is not open.');
      await new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    }
    async function closeStream() {
      const active = stream;
      stream = null;
      if (!active) return;
      await new Promise((resolve, reject) => active.end((error) => (error ? reject(error) : resolve())));
    }

    for await (const chunk of source.pipe(decipher)) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length > 0) {
        if (state === 'headerLength') {
          if (pending.length < 4) break;
          expectedHeaderLength = pending.readUInt32BE(0);
          pending = pending.subarray(4);
          if (expectedHeaderLength === 0) {
            if (pending.length > 0) throw new Error('Unexpected bytes after archive end marker.');
            state = 'done';
            break;
          }
          if (expectedHeaderLength > 1_000_000) throw new Error('Archive header is unreasonably large.');
          state = 'header';
        } else if (state === 'header') {
          if (pending.length < expectedHeaderLength) break;
          const raw = pending.subarray(0, expectedHeaderLength).toString('utf8');
          pending = pending.subarray(expectedHeaderLength);
          const parsed = JSON.parse(raw);
          if (typeof parsed.path !== 'string' || !Number.isFinite(parsed.size) || parsed.size < 0) {
            throw new Error('Archive header is malformed.');
          }
          const target = safeTarget(outDir, parsed.path);
          await fsp.mkdir(path.dirname(target), { recursive: true });
          stream = fs.createWriteStream(target);
          hash = crypto.createHash('sha256');
          remaining = parsed.size;
          current = { path: parsed.path, size: parsed.size, target };
          state = remaining === 0 ? 'digest' : 'file';
        } else if (state === 'file') {
          if (remaining > 0) {
            const take = Math.min(remaining, pending.length);
            const data = pending.subarray(0, take);
            pending = pending.subarray(take);
            remaining -= take;
            hash.update(data);
            await writeToStream(data);
          }
          if (remaining === 0) {
            await closeStream();
            state = 'digest';
          }
        } else if (state === 'digest') {
          if (pending.length < 32) break;
          const expected = pending.subarray(0, 32);
          pending = pending.subarray(32);
          const actual = hash.digest();
          if (!expected.equals(actual)) {
            throw new Error(`Integrity check failed for ${current.path}.`);
          }
          extracted.push({ path: current.path, size: current.size, sha256: actual.toString('hex') });
          current = null;
          hash = null;
          state = 'headerLength';
        } else {
          break;
        }
      }
      if (state === 'done') break;
    }
    if (state !== 'done') {
      await closeStream();
      throw new Error('Archive ended before its completion marker.');
    }
    return { entries: extracted, bytes: extracted.reduce((total, entry) => total + entry.size, 0) };
  } finally {
    await handle.close();
  }
}

export async function writeManifest({ manifest, jsonPath, key }) {
  const json = JSON.stringify(manifest, null, 2);
  await fsp.writeFile(jsonPath, json, { mode: 0o600 });
  const encryptedPath = `${jsonPath}.enc`;
  await fsp.writeFile(encryptedPath, encryptBuffer(Buffer.from(json, 'utf8'), key), { mode: 0o600 });
  return { jsonPath, encryptedPath, sha256: crypto.createHash('sha256').update(json).digest('hex') };
}
