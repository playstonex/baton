import os from 'node:os';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import QRCode from 'qrcode';
import { generateKeyPair, keyToFingerprint } from '@flowwhips/shared';
import { AgentManager } from './agent/manager.js';
import { createAdapter, ProviderRegistry } from './agent/index.js';
import { Transport } from './transport/index.js';
import { RelayConnection } from './transport/relay.js';
import { FileWatcher } from './watcher/index.js';
import { Orchestrator } from './orchestrator/index.js';
import type { PipelineStep } from './orchestrator/index.js';
import type {
  StartAgentRequest,
  HostInfoResponse,
  ParsedEvent,
  ClientMessage,
  DaemonMessage,
} from '@flowwhips/shared';

const DEFAULT_PORT = 3210;

function getLocalIp(): string | null {
  const nets = Object.values(os.networkInterfaces());
  for (const interfaces of nets) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

export function createDaemon(port = DEFAULT_PORT) {
  const app = new Hono();
  const agentManager = new AgentManager();
  const orchestrator = new Orchestrator(agentManager);
  const transport = new Transport(agentManager, port);
  const watchers = new Map<string, FileWatcher>();
  let relayConnection: RelayConnection | null = null;

  app.use('*', cors());

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.0.1',
      relay: relayConnection?.connected ?? false,
    });
  });

  app.get('/api/host', (c) => {
    const agents = agentManager.list();
    return c.json({
      id: 'local',
      name: os.hostname(),
      os: process.platform,
      status: 'online',
      agents: agents.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        projectPath: a.projectPath,
      })),
    } satisfies HostInfoResponse);
  });

  app.post('/api/agents/start', async (c) => {
    const body = await c.req.json<StartAgentRequest>();
    const adapter = createAdapter(body.agentType, body.mode ?? 'pty');

    const sessionId = await agentManager.start(
      {
        type: body.agentType,
        projectPath: body.projectPath,
        args: body.args,
        env: body.env,
      },
      adapter,
    );

    transport.registerSessionEvents(sessionId);

    // Start file watcher for the project
    if (!watchers.has(body.projectPath)) {
      const watcher = new FileWatcher({ projectPath: body.projectPath });
      watcher.onFileChange((event: ParsedEvent) => {
        const msg: DaemonMessage = { type: 'parsed_event', sessionId, event };
        transport.broadcast(msg);
        relayConnection?.send(msg);
      });
      watcher.start();
      watchers.set(body.projectPath, watcher);
    }

    return c.json({ sessionId, agentType: body.agentType, status: 'running' });
  });

  app.post('/api/agents/:id/stop', async (c) => {
    const id = c.req.param('id');
    await agentManager.stop(id);
    return c.json({ ok: true });
  });

  app.get('/api/agents', (c) => {
    return c.json(agentManager.list());
  });

  app.get('/api/agents/:id', (c) => {
    const agent = agentManager.get(c.req.param('id'));
    if (!agent) return c.json({ error: 'Not found' }, 404);
    return c.json(agent);
  });

  app.get('/api/agents/:id/events', (c) => {
    try {
      const events = agentManager.getEventHistory(c.req.param('id'));
      return c.json(events);
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  app.get('/api/agents/:id/output', (c) => {
    try {
      const output = agentManager.getOutputHistory(c.req.param('id'));
      return c.json({ output });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  // File browser API
  const IGNORE_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    '.turbo',
    '.next',
    '.cache',
    '__pycache__',
    '.DS_Store',
  ]);

  app.get('/api/files', async (c) => {
    const dir = c.req.query('path') ?? '/';
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const items = await Promise.all(
        entries
          .filter((e) => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
          .map(async (e) => {
            const fullPath = join(dir, e.name);
            try {
              const s = await stat(fullPath);
              return {
                name: e.name,
                path: fullPath,
                isDir: e.isDirectory(),
                size: s.size,
                modified: s.mtime.toISOString(),
              };
            } catch {
              return null;
            }
          }),
      );
      const sorted = items.filter(Boolean).sort((a, b) => {
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1;
        return a!.name.localeCompare(b!.name);
      });
      return c.json({ path: dir, items: sorted });
    } catch {
      return c.json({ error: 'Cannot read directory' }, 400);
    }
  });

  app.get('/api/files/content', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'Missing path' }, 400);

    try {
      const s = await stat(filePath);
      if (s.isDirectory()) return c.json({ error: 'Path is a directory' }, 400);
      if (s.size > 1024 * 1024) return c.json({ error: 'File too large (max 1MB)' }, 400);

      const content = await readFile(filePath, 'utf-8');
      return c.json({
        path: filePath,
        name: basename(filePath),
        ext: extname(filePath),
        content,
        size: s.size,
      });
    } catch {
      return c.json({ error: 'Cannot read file' }, 400);
    }
  });

  // Provider API
  const providerRegistry = new ProviderRegistry();

  app.get('/api/providers', async (c) => {
    if (!providerRegistry.ensureLoaded()) await providerRegistry.load();
    return c.json(providerRegistry.list());
  });

  app.get('/api/providers/:name', async (c) => {
    if (!providerRegistry.ensureLoaded()) await providerRegistry.load();
    const profile = providerRegistry.get(c.req.param('name'));
    if (!profile) return c.json({ error: 'Provider not found' }, 404);
    return c.json(profile);
  });

  app.post('/api/providers', async (c) => {
    if (!providerRegistry.ensureLoaded()) await providerRegistry.load();
    const body = await c.req.json<{
      name: string;
      type: string;
      binary?: string;
      models?: string[];
    }>();
    await providerRegistry.set(body.name, {
      type: body.type as 'claude-code' | 'codex' | 'opencode' | 'custom',
      binary: body.binary,
      args: [],
      env: {},
      models: body.models,
      profiles: {},
    });
    return c.json({ ok: true }, 201);
  });

  app.delete('/api/providers/:name', async (c) => {
    if (!providerRegistry.ensureLoaded()) await providerRegistry.load();
    const removed = await providerRegistry.remove(c.req.param('name'));
    if (!removed) return c.json({ error: 'Provider not found' }, 404);
    return c.json({ ok: true });
  });

  // Pipeline / Orchestration API
  app.post('/api/pipelines', async (c) => {
    const body = await c.req.json<{ name: string; steps: PipelineStep[] }>();
    const pipeline = orchestrator.create(body.name, body.steps);
    return c.json(pipeline, 201);
  });

  app.post('/api/pipelines/:id/run', async (c) => {
    const id = c.req.param('id');
    if (!orchestrator.get(id)) return c.json({ error: 'Pipeline not found' }, 404);

    // Run asynchronously
    orchestrator.run(id).catch(() => {});
    return c.json({ status: 'running' });
  });

  app.get('/api/pipelines', (c) => {
    return c.json(orchestrator.list());
  });

  app.get('/api/pipelines/:id', (c) => {
    const pipeline = orchestrator.get(c.req.param('id'));
    if (!pipeline) return c.json({ error: 'Not found' }, 404);
    return c.json(pipeline);
  });

  // Connect to Relay for remote access
  app.post('/api/relay/connect', async (c) => {
    const body = await c.req.json<{ relayUrl: string; token: string }>();
    if (relayConnection) relayConnection.disconnect();

    const hostId = crypto.randomUUID();

    relayConnection = new RelayConnection({
      relayUrl: body.relayUrl,
      hostId,
      token: body.token,
      onMessage: (msg: DaemonMessage) => {
        // Messages from remote clients — forward to agent manager
        if ('type' in msg) {
          const clientMsg = msg as unknown as ClientMessage;
          if (clientMsg.type === 'terminal_input' && clientMsg.sessionId) {
            try {
              agentManager.write(clientMsg.sessionId, clientMsg.data);
            } catch {
              /* session might not exist */
            }
          }
        }
      },
      onStatusChange: (connected) => {
        console.log(`Relay: ${connected ? 'connected' : 'disconnected'}`);
      },
    });

    relayConnection.connect();
    return c.json({ hostId, status: 'connecting' });
  });

  app.post('/api/relay/disconnect', (c) => {
    relayConnection?.disconnect();
    relayConnection = null;
    return c.json({ ok: true });
  });

  app.get('/api/relay/status', (c) => {
    return c.json({
      connected: relayConnection?.connected ?? false,
    });
  });

  // QR Code Pairing — generates daemon keypair + QR for mobile scanning
  let daemonKeyPair: ReturnType<typeof generateKeyPair> | null = null;

  app.get('/api/pair/qr', async (c) => {
    if (!daemonKeyPair) {
      daemonKeyPair = generateKeyPair();
    }
    const fingerprint = keyToFingerprint(daemonKeyPair.publicKey);
    const relayUrl = c.req.query('relay') ?? `ws://localhost:${DEFAULT_PORT + 20}`;
    const payload = JSON.stringify({
      daemonId: 'local',
      fp: fingerprint,
      relay: relayUrl,
    });
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 256 });
    return c.json({ qr: qrDataUrl, fingerprint, relayUrl });
  });

  return { app, agentManager, transport, port, watchers };
}

export async function main() {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const { app, transport } = createDaemon(port);

  transport.start();

  const hostname = process.env.HOST || '0.0.0.0';
  serve({ fetch: app.fetch, port, hostname }, (info: { port: number; hostname: string }) => {
    const localIp = getLocalIp();
    console.log(`\n  FlowWhips Daemon v0.0.1`);
    console.log(`  HTTP:      http://${hostname}:${info.port}`);
    console.log(`  WebSocket: ws://${hostname}:${info.port + 1}`);
    if (localIp && hostname === '0.0.0.0') {
      console.log(`  LAN HTTP:  http://${localIp}:${info.port}`);
      console.log(`  LAN WS:    ws://${localIp}:${info.port + 1}`);
    }
    console.log(`  Host: ${os.hostname()} (${process.platform})\n`);
  });

  process.on('SIGINT', () => {
    transport.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    transport.stop();
    process.exit(0);
  });
}

main();
