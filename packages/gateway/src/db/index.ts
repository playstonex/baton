import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export function createDb(path = ':memory:') {
  const sqlite = new Database(path);
  return drizzle(sqlite, { schema });
}

export { schema };
