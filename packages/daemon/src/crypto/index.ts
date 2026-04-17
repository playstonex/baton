import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptionKeys {
  encryptKey: Buffer;
  decryptKey: Buffer;
}

// Derive a shared AES-256 key from a pairing secret
export function deriveKeyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(`flowwhips-${secret}`).digest();
}

// Generate a random session key
export function generateSessionKey(): Buffer {
  return randomBytes(32);
}

export function encrypt(data: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encryptedB64: string, key: Buffer): string {
  const buf = Buffer.from(encryptedB64, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}
