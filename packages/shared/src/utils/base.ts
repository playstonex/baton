// Cross-platform UUID generation
// In Node.js environment, use node:crypto
// In React Native, use a polyfill

let randomUUID: () => string;

// Check if we're in a Node.js environment
if (typeof process !== 'undefined' && process.versions?.node) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  randomUUID = () => require('crypto').randomUUID();
} else {
  // React Native / browser polyfill
  randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}

export function generateId(): string {
  return randomUUID();
}

export function timestamp(): number {
  return Date.now();
}
