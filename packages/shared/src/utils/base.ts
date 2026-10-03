// Cross-platform UUID generation (ESM-safe)
// Node.js: use node:crypto via dynamic import (lazy, cached)
// Browser / React Native: Math.random polyfill

let _randomUUID: (() => string) | null = null;

// Eagerly init Node.js crypto
if (typeof process !== 'undefined' && process.versions?.node) {
  import('node:crypto').then((mod) => {
    _randomUUID = mod.randomUUID;
  }).catch(() => {});
}

function randomUUID(): string {
  if (_randomUUID) return _randomUUID();
  // Fallback for environments without node:crypto or before async init completes
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateId(): string {
  return randomUUID();
}

// ── Sortable session IDs (ULID-style) ─────────────────────────────────
//
// Session ids used to be UUIDv4 — random, so "newest sessions first" had to
// be derived from timestamps scattered across records. A ULID encodes the
// creation time in its first 10 chars, so lexicographic order == creation
// order. Borrowed from the paseo reference project's identity scheme.

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const g = typeof crypto !== 'undefined' ? crypto : undefined;
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(out);
  } else {
    for (let i = 0; i < len; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Time-sortable unique id: 26 chars, Crockford base32 (ULID layout). */
export function generateSessionId(): string {
  let time = Date.now();
  let ts = '';
  for (let i = 9; i >= 0; i--) {
    ts = ULID_ALPHABET[time % 32] + ts;
    time = Math.floor(time / 32);
  }
  const rnd = randomBytes(10);
  let tail = '';
  // 80 bits of randomness → 16 base32 chars (5 bits each)
  let bits = 0;
  let acc = 0;
  for (const byte of rnd) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      tail += ULID_ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  while (tail.length < 16) tail += ULID_ALPHABET[0];
  return ts + tail.slice(0, 16);
}

export function timestamp(): number {
  return Date.now();
}
