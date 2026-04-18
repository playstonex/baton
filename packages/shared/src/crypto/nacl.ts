import nacl from 'tweetnacl';

const NONCE_LENGTH = nacl.secretbox.nonceLength;
const SHARED_KEY_LENGTH = nacl.secretbox.keyLength;

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function assertLength(value: Uint8Array, expected: number, name: string): void {
  if (value.length !== expected) {
    throw new Error(`${name} must be ${expected} bytes`);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';

  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return hex;
}

function sha256(input: Uint8Array): Uint8Array {
  const bitLength = BigInt(input.length) * 8n;
  const paddedLength = Math.ceil((input.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);

  padded.set(input);
  padded[input.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      schedule[index] =
        (padded[base] << 24) |
        (padded[base + 1] << 16) |
        (padded[base + 2] << 8) |
        padded[base + 3];
    }

    for (let index = 16; index < 64; index += 1) {
      const sigma0 =
        rotateRight(schedule[index - 15], 7) ^
        rotateRight(schedule[index - 15], 18) ^
        (schedule[index - 15] >>> 3);
      const sigma1 =
        rotateRight(schedule[index - 2], 17) ^
        rotateRight(schedule[index - 2], 19) ^
        (schedule[index - 2] >>> 10);

      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);

  for (let index = 0; index < state.length; index += 1) {
    const value = state[index];
    const base = index * 4;

    digest[base] = value >>> 24;
    digest[base + 1] = (value >>> 16) & 0xff;
    digest[base + 2] = (value >>> 8) & 0xff;
    digest[base + 3] = value & 0xff;
  }

  return digest;
}

export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair();
}

export function deriveSharedKey(peerPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array {
  return nacl.box.before(peerPublicKey, mySecretKey);
}

export function encrypt(
  plaintext: Uint8Array,
  nonce: Uint8Array,
  sharedKey: Uint8Array,
): Uint8Array {
  assertLength(nonce, NONCE_LENGTH, 'nonce');
  assertLength(sharedKey, SHARED_KEY_LENGTH, 'sharedKey');
  return nacl.secretbox(plaintext, nonce, sharedKey);
}

export function decrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  sharedKey: Uint8Array,
): Uint8Array | null {
  assertLength(nonce, NONCE_LENGTH, 'nonce');
  assertLength(sharedKey, SHARED_KEY_LENGTH, 'sharedKey');
  return nacl.secretbox.open(ciphertext, nonce, sharedKey);
}

export function generateNonce(): Uint8Array {
  return nacl.randomBytes(NONCE_LENGTH);
}

export function incrementNonce(nonce: Uint8Array): Uint8Array {
  assertLength(nonce, NONCE_LENGTH, 'nonce');

  const nextNonce = nonce.slice();

  for (let index = nextNonce.length - 1; index >= nextNonce.length - 8; index -= 1) {
    nextNonce[index] = (nextNonce[index] + 1) & 0xff;

    if (nextNonce[index] !== 0) {
      break;
    }
  }

  return nextNonce;
}

export function keyToFingerprint(key: Uint8Array): string {
  return bytesToHex(sha256(key));
}
