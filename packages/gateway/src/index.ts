import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signToken, verifyToken, generatePairingCode } from './services/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3220;

const pairingCodes = new Map<string, { hostId: string; code: string; token: string; expiresAt: number }>();

function initDatabase(): Database {
  const db = new Database(':memory:');
  const migrationSql = readFileSync(join(__dirname, 'db/migrations/0001_init.sql'), 'utf-8');
  for (const stmt of migrationSql.split(';').filter((s) => s.trim())) {
    db.exec(stmt);
  }
  return db;
}

function createRateLimiter(maxRequests = 100, windowMs = 60 * 1000) {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(c: any): boolean {
    const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || c.env.REQUEST_IP || 'unknown';
    const now = Date.now();

    for (const [key, record] of requests) {
      if (now > record.resetAt) requests.delete(key);
    }

    const record = requests.get(ip);

    if (!record || now > record.resetAt) {
      requests.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (record.count >= maxRequests) {
      return false;
    }

    record.count++;
    return true;
  };
}

export function createGateway(port = DEFAULT_PORT): { app: Hono; db: Database; port: number } {
  const app = new Hono();
  const db = initDatabase();
  const rateLimit = createRateLimiter(30, 60 * 1000);

  app.use('*', logger());
  app.use('*', cors());

  app.get('/api/health', (c) => c.json({ status: 'ok', service: 'baton-gateway' }));

  app.post('/api/v1/auth/host-token', async (c) => {
    if (!rateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

    await c.req.json<{ hostName?: string }>().catch(() => ({}));
    const hostId = crypto.randomUUID();
    const token = await signToken({ sub: hostId, role: 'host', hostId });
    return c.json({ hostId, token });
  });

  app.post('/api/v1/auth/pair', async (c) => {
    if (!rateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

    const payload = await verifyToken(auth.slice(7));
    if (!payload || payload.role !== 'host') return c.json({ error: 'Invalid host token' }, 401);

    const code = generatePairingCode();
    const clientToken = await signToken({ sub: payload.hostId!, role: 'client', hostId: payload.hostId! });

    pairingCodes.set(code, {
      hostId: payload.hostId!,
      code,
      token: clientToken,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return c.json({ code, expiresIn: 600 });
  });

  app.post('/api/v1/auth/verify-code', async (c) => {
    const body = await c.req.json<{ code: string }>().catch(() => ({ code: '' }));
    const entry = pairingCodes.get(body.code);

    if (!entry || Date.now() > entry.expiresAt) {
      pairingCodes.delete(body.code);
      return c.json({ error: 'Invalid or expired code' }, 400);
    }

    const token = entry.token;
    pairingCodes.delete(body.code);

    return c.json({ token, hostId: entry.hostId });
  });

  app.post('/api/v1/auth/verify', async (c) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

    const payload = await verifyToken(auth.slice(7));
    if (!payload) return c.json({ error: 'Invalid token' }, 401);

    return c.json({ valid: true, role: payload.role, hostId: payload.hostId });
  });

  app.get('/api/v1/hosts', (c) => {
    const hosts = db.prepare('SELECT id, name, hostname, os, status, last_seen, created_at FROM hosts').all();
    return c.json(hosts);
  });

  app.post('/api/v1/hosts', async (c) => {
    const body = await c.req.json<{ name: string; hostname?: string; os?: string }>();
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO hosts (id, name, hostname, os, status, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, body.name, body.hostname ?? null, body.os ?? null, 'online', new Date().toISOString(), new Date().toISOString());
    return c.json({ id, status: 'online' }, 201);
  });

  return { app, db, port };
}

export function main() {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const { app } = createGateway(port);

  Bun.serve({ fetch: app.fetch, port });
  console.log(`\n  Baton Gateway v0.0.1`);
  console.log(`  HTTP: http://localhost:${port}\n`);
}

main();
