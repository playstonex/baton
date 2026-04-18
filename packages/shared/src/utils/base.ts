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

export function timestamp(): number {
  return Date.now();
}
