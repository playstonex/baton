import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';

export function createDb(path = ':memory:') {
  const sqlite = new Database(path, { create: true });
  return drizzle({ client: sqlite, schema });
}

export { schema };
