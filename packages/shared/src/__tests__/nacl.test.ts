import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  generateNonce,
  incrementNonce,
  keyToFingerprint,
} from '../crypto/nacl.js';

describe('NaCl Crypto', () => {
  it('generates a valid key pair', () => {
    const { publicKey, secretKey } = generateKeyPair();
    expect(publicKey).toHaveLength(32);
    expect(secretKey).toHaveLength(32);
  });

  it('derives the same shared key from both sides', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const sharedAB = deriveSharedKey(alice.publicKey, bob.secretKey);
    const sharedBA = deriveSharedKey(bob.publicKey, alice.secretKey);

    expect(sharedAB).toHaveLength(32);
    expect(sharedBA).toHaveLength(32);

    let equal = true;
    for (let i = 0; i < 32; i++) {
      if (sharedAB[i] !== sharedBA[i]) {
        equal = false;
        break;
      }
    }
    expect(equal).toBe(true);
  });

  it('encrypts and decrypts with shared key', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const shared = deriveSharedKey(alice.publicKey, bob.secretKey);

    const nonce = generateNonce();
    const plaintext = new TextEncoder().encode('Hello, FlowWhips E2EE!');

    const ciphertext = encrypt(plaintext, nonce, shared);
    expect(ciphertext).not.toBeNull();
    expect(ciphertext!.length).toBeGreaterThan(plaintext.length);

    const decrypted = decrypt(ciphertext!, nonce, shared);
    expect(decrypted).not.toBeNull();
    expect(new TextDecoder().decode(decrypted!)).toBe('Hello, FlowWhips E2EE!');
  });

  it('returns null when decrypting with wrong key', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const eve = generateKeyPair();

    const sharedAB = deriveSharedKey(alice.publicKey, bob.secretKey);
    const sharedAE = deriveSharedKey(alice.publicKey, eve.secretKey);

    const nonce = generateNonce();
    const plaintext = new TextEncoder().encode('secret message');
    const ciphertext = encrypt(plaintext, nonce, sharedAB);

    const decrypted = decrypt(ciphertext!, nonce, sharedAE);
    expect(decrypted).toBeNull();
  });

  it('generates unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const nonce = generateNonce();
      nonces.add(String.fromCharCode(...nonce));
    }
    expect(nonces.size).toBe(100);
  });

  it('increments nonce as big-endian counter', () => {
    const nonce = new Uint8Array(24);
    const next = incrementNonce(nonce);
    expect(next[23]).toBe(1);

    const maxByte = new Uint8Array(24);
    maxByte[23] = 255;
    const overflow = incrementNonce(maxByte);
    expect(overflow[23]).toBe(0);
    expect(overflow[22]).toBe(1);
  });

  it('produces consistent fingerprints', () => {
    const { publicKey } = generateKeyPair();
    const fp1 = keyToFingerprint(publicKey);
    const fp2 = keyToFingerprint(publicKey);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex
  });

  it('produces different fingerprints for different keys', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(keyToFingerprint(a.publicKey)).not.toBe(keyToFingerprint(b.publicKey));
  });

  it('handles unicode in encrypt/decrypt', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const shared = deriveSharedKey(alice.publicKey, bob.secretKey);
    const nonce = generateNonce();

    const plaintext = new TextEncoder().encode('你好世界 🌍 こんにちは');
    const ciphertext = encrypt(plaintext, nonce, shared);
    const decrypted = decrypt(ciphertext!, nonce, shared);

    expect(new TextDecoder().decode(decrypted!)).toBe('你好世界 🌍 こんにちは');
  });
});
