import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKeyFromSecret, generateSessionKey } from '../crypto/index.js';

describe('Crypto', () => {
  it('encrypts and decrypts roundtrip', () => {
    const key = generateSessionKey();
    const plaintext = 'Hello, FlowWhips!';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('derives consistent key from secret', () => {
    const key1 = deriveKeyFromSecret('my-secret');
    const key2 = deriveKeyFromSecret('my-secret');
    expect(key1.equals(key2)).toBe(true);
  });

  it('different secrets produce different keys', () => {
    const key1 = deriveKeyFromSecret('secret-a');
    const key2 = deriveKeyFromSecret('secret-b');
    expect(key1.equals(key2)).toBe(false);
  });

  it('generates 32-byte session keys', () => {
    const key = generateSessionKey();
    expect(key).toHaveLength(32);
  });

  it('fails to decrypt with wrong key', () => {
    const key1 = generateSessionKey();
    const key2 = generateSessionKey();
    const encrypted = encrypt('test', key1);
    expect(() => decrypt(encrypted, key2)).toThrow();
  });

  it('handles unicode content', () => {
    const key = generateSessionKey();
    const text = '你好世界 🌍 こんにちは';
    expect(decrypt(encrypt(text, key), key)).toBe(text);
  });
});
