import { randomUUID } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

export function timestamp(): number {
  return Date.now();
}
