import crypto from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function decodeKey(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('BACKUP_ENCRYPTION_KEY is required (base64-encoded 32 bytes).');
  }
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return key;
}

export function encryptBuffer(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('SSMB1'), iv, tag, ciphertext]);
}

export function decryptBuffer(payload, key) {
  if (payload.length < 5 + IV_BYTES + TAG_BYTES) throw new Error('Encrypted payload is too short.');
  if (payload.subarray(0, 5).toString('utf8') !== 'SSMB1') throw new Error('Encrypted payload magic is invalid.');
  const iv = payload.subarray(5, 5 + IV_BYTES);
  const tag = payload.subarray(5 + IV_BYTES, 5 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(5 + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export { IV_BYTES, TAG_BYTES, KEY_BYTES };
