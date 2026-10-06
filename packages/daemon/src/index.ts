import os from 'node:os';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, extname, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import { generateKeyPair, keyToFingerprint } from '@baton/shared/crypto';
import { AgentManager } from './agent/manager.js';
import { createAdapter, createSdkAdapter, ProviderRegistry } from './agent/index.js';
import {
  loadAcpProviders,
  refreshAcpAdapters,
  hasAcpProvider,
  getAcpSdkAdapter,
  getAcpPtyAdapter,
  acpProviderAvailable,
} from './agent/acp.js';
import { Transport } from './transport/index.js';
import { RelayConnection } from './transport/relay.js';
import { FileWatcher } from './watcher/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { ScheduleService } from './scheduler/schedule.js';
import { WorkspaceCheckpointService } from './workspace/checkpoint.js';
import { getVapidKeys } from './system/vapid.js';
import { transcribeClip } from './system/stt.js';
import { AnalyticsService } from './system/analytics.js';
import { PushNotificationService } from './system/push.js';
import { ContextCompressor } from './parser/compressor.js';
import { GitService } from './git/index.js';
import { createDefaultForgeRegistry, parseRepoRef, checkoutPullRequest } from './forge/index.js';
import { listWorktrees, createWorktree, archiveWorktree } from './worktree/core.js';
import { ApiProviderRegistry } from './api-converter/index.js';
import { proxyResponses, resolveApiKey } from './api-converter/proxy.js';
import { previewCodexProviders } from './api-converter/codex-sync.js';
import { loadBatonEnv } from './env.js';
import type { ResponsesApiRequest } from './api-converter/types.js';
import { acquirePid, releasePid, DaemonAlreadyRunningError, BATON_VERSION } from '@baton/shared';
import type { PipelineStep } from './orchestrator/index.js';
import type {
  ProviderProfile,
  StartAgentRequest,
  HostInfoResponse,
  ParsedEvent,
  ClientMessage,
  DaemonMessage,
  ApiProviderProfile,
  ApiProviderConfig,
} from '@baton/shared';

const DEFAULT_PORT = 3210;

function getLocalIps(): { ipv4: string | null; ipv6: string | null } {
  const nets = Object.values(os.networkInterfaces());
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  for (const interfaces of nets) {
    for (const iface of interfaces ?? []) {
      if (iface.internal) continue;
      if (iface.family === 'IPv4' && !ipv4) {
        ipv4 = iface.address;
      }
      if (iface.family === 'IPv6' && !ipv6) {
        ipv6 = iface.address;
      }
    }
  }
  return { ipv4, ipv6 };
}

/** Format host for display in URLs — wraps IPv6 addresses in brackets. */
function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export function isLoopbackAddress(ip: string): boolean {
  const addr = ip.replace(/^::ffff:/i, ''); // IPv4-mapped IPv6
  return addr === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '[::1]' || host === '::1' || isLoopbackAddress(host);
  } catch {
    return false;
  }
}

/**
 * Provider env vars must look like an API key name. `envKey` selects which
 * process env var the proxy forwards upstream, so an unconstrained value
 * (e.g. AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN) would turn the proxy into a
 * general env-var exfiltration channel.
 */
export const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]*_API_KEY$/;

export function createDaemon(port = DEFAULT_PORT) {
  const app = new Hono();
  const batonHome = process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  const agentManager = new AgentManager();
  void agentManager.restore();
  // Generic ACP providers (~/.baton/acp.json) — fire-and-forget; the start
  // route re-loads on demand if an instance isn't warm yet.
  void loadAcpProviders().then((profiles) => {
    refreshAcpAdapters(profiles);
    if (profiles.size > 0) {
      console.log(`[baton] acp: ${profiles.size} generic provider(s) loaded`);
    }
  });
  const orchestrator = new Orchestrator(agentManager);
  const scheduler = new ScheduleService(agentManager);
  void scheduler.restore();
  const checkpointService = new WorkspaceCheckpointService();
  const analytics = new AnalyticsService(join(batonHome, 'analytics.db'));
  const pushService = new PushNotificationService();
  const compressor = new ContextCompressor();
  const gitService = new GitService();
  const forgeRegistry = createDefaultForgeRegistry();
  const transport = new Transport(agentManager, port, {
    onPushTokenRegister: (clientId, token, platform) => {
      pushService.register(clientId, token, platform as 'ios' | 'android' | 'web');
    },
    onPushTokenUnregister: (clientId) => {
      pushService.unregister(clientId);
    },
    onAccessModeChange: (mode) => {
      pushService.setAccessMode(mode);
    },
  });
  // Any session change (started/stopped/archived/renamed — from ANY path:
  // HTTP, WS, MCP, scheduler, orchestrator) pushes a fresh agent_list to all
  // connected clients. Previously only WS-open did, so dashboards never saw
  // sessions spawned by other clients.
  agentManager.onAgentsChanged(() => {
    transport.broadcastAgentList();
    syncActiveAgents();
  });
  const watchers = new Map<string, FileWatcher>();
  let relayConnection: RelayConnection | null = null;

  const allowedProjectPaths = new Set<string>();

  function isPathAllowed(targetPath: string): boolean {
    const resolved = resolve(targetPath);
    for (const allowed of allowedProjectPaths) {
      const allowedResolved = resolve(allowed) + sep;
      if (resolved.startsWith(allowedResolved) || resolved === resolve(allowed)) {
        return true;
      }
    }
    for (const agent of agentManager.list()) {
      if (agent.projectPath) {
        const allowedResolved = resolve(agent.projectPath) + sep;
        if (resolved.startsWith(allowedResolved) || resolved === resolve(agent.projectPath)) {
          return true;
        }
      }
    }
    return false;
  }

  app.use('*', cors());

  // ── Local-only guard for credential-bearing routes ───────────────────
  // /proxy/* attaches a real API key (resolved from the daemon's env) to an
  // outbound request, and /api/api-providers mutations decide WHERE that key
  // goes (baseUrl) and WHICH env var is read (envKey). The daemon listens on
  // all interfaces with no auth and permissive CORS, so without this guard any
  // LAN peer — or any web page the user visits, via a cross-origin fetch to
  // localhost — could point a provider at its own server and have the daemon
  // POST the key there. Require a loopback peer AND no foreign browser Origin.
  // Codex (the proxy's real caller) runs on this host and sends no Origin; the
  // web UI is served from localhost (Vite dev or same-origin).
  const localOnly: MiddlewareHandler = async (c, next) => {
    if (c.req.method === 'GET' && !c.req.path.startsWith('/proxy/')) return next();
    const ip = (c.env as { requestIP?: string } | undefined)?.requestIP;
    if (!ip || !isLoopbackAddress(ip)) {
      return c.json({ error: 'This endpoint is only available from the daemon host' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin && !isLocalOrigin(origin)) {
      return c.json({ error: 'Cross-origin request refused' }, 403);
    }
    return next();
  };
  app.use('/api/api-providers', localOnly);
  app.use('/api/api-providers/*', localOnly);
  app.use('/proxy/*', localOnly);

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      version: BATON_VERSION,
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

  app.get('/api/system/stats', async (c) => {
    const { collectSystemStats } = await import('./system/stats.js');
    return c.json(await collectSystemStats(agentManager));
  });

  app.get('/api/analytics/health', (c) => {
    return c.json(analytics.getHealthScore());
  });

  app.get('/api/analytics/hourly', (c) => {
    const hours = parseInt(c.req.query('hours') ?? '24', 10);
    return c.json(analytics.getHourlyStats(hours));
  });

  app.get('/api/analytics/session/:id', (c) => {
    const stats = analytics.getSessionStats(c.req.param('id'));
    return c.json(stats);
  });

  app.get('/api/analytics/recent', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    return c.json(analytics.getRecentEvents(limit));
  });

  app.post('/api/push/register', async (c) => {
    const body = await c.req.json<{
      clientId: string;
      token: string;
      platform: 'ios' | 'android' | 'web';
    }>();
    pushService.register(body.clientId, body.token, body.platform);
    return c.json({ ok: true });
  });

  app.post('/api/push/unregister', async (c) => {
    const body = await c.req.json<{ clientId: string }>();
    pushService.unregister(body.clientId);
    return c.json({ ok: true });
  });

  app.get('/api/push/subscriptions', (c) => {
    return c.json(pushService.listSubscriptions());
  });

  // Voice dictation for chat clients — one recorded clip in, transcript out.
  // The Deepgram relay (system/stt.ts) keeps the API key entirely on the host.
  app.post('/api/stt', async (c) => {
    const outcome = await transcribeClip({
      audio: await c.req.arrayBuffer(),
      contentType: c.req.header('content-type'),
    });
    if (!outcome.ok) {
      return c.json({ error: outcome.error }, outcome.status as 400 | 413 | 502 | 503);
    }
    return c.json({ text: outcome.text });
  });

  app.post('/api/agents/start', async (c) => {
    const body = await c.req.json<StartAgentRequest>();
    const absPath = resolve(body.projectPath);
    const safe = await access(absPath)
      .then(() => true)
      .catch(() => false);
    if (!safe) {
      return c.json({ error: 'Invalid project path' }, 400);
    }
    allowedProjectPaths.add(absPath);

    const agentConfig = {
      type: body.agentType,
      projectPath: body.projectPath,
      args: body.args,
      env: body.env,
    };

    // Generic ACP: resolve the per-provider adapter from $BATON_HOME/acp.json.
    // Profiles warm lazily — reload the file when a name misses the cache.
    if (body.agentType === 'acp') {
      if (!body.acpProvider) {
        return c.json({ error: 'acpProvider is required for agentType "acp"' }, 400);
      }
      if (!hasAcpProvider(body.acpProvider)) {
        refreshAcpAdapters(await loadAcpProviders());
      }
      if (!hasAcpProvider(body.acpProvider)) {
        return c.json(
          { error: `Unknown ACP provider '${body.acpProvider}' — check ~/.baton/acp.json` },
          400,
        );
      }
    }

    // SDK mode: try the SDK adapter first; fall back to PTY when the SDK
    // backend is unavailable on this host (e.g. missing CLI / SDK package) —
    // an explicit mode:'sdk' degrades instead of spawning a zombie session.
    const sdkAdapter =
      body.agentType === 'acp'
        ? getAcpSdkAdapter(body.acpProvider!)
        : createSdkAdapter(body.agentType);
    const sdkUsable = !!sdkAdapter && sdkAdapter.isSdkAvailable();
    const wantSdk =
      (body.mode ?? 'pty') === 'sdk'
        ? sdkUsable
        : body.mode === 'auto' && sdkUsable;
    let sessionId: string;
    if (wantSdk && sdkAdapter) {
      sessionId = await agentManager.startSdk(agentConfig, sdkAdapter);
    } else if (body.agentType === 'acp') {
      const adapter = getAcpPtyAdapter(body.acpProvider!);
      if (!adapter || !adapter.detect(absPath)) {
        return c.json(
          { error: `ACP provider '${body.acpProvider}' command not found on this host` },
          400,
        );
      }
      sessionId = await agentManager.start(agentConfig, adapter);
    } else {
      const adapter = createAdapter(body.agentType, body.mode ?? 'pty');
      if (!adapter.detect(absPath)) {
        return c.json(
          { error: `${body.agentType} CLI not found on this host — install it or pick another agent` },
          400,
        );
      }
      sessionId = await agentManager.start(agentConfig, adapter);
    }

    transport.registerSessionEvents(sessionId);
    syncActiveAgents();

    agentManager.onEvent(sessionId, (event: ParsedEvent) => {
      analytics.logEvent(sessionId, event);
      compressor.addEvent(sessionId, event);

      if (pushService.shouldNotify(event.type)) {
        pushService.broadcast({
          title: `Agent ${event.type.replace(/_/g, ' ')}`,
          body:
            event.type === 'permission_request'
              ? `Permission needed for ${(event as Extract<ParsedEvent, { type: 'permission_request' }>).tool}`
              : event.type === 'error'
                ? (event as Extract<ParsedEvent, { type: 'error' }>).message
                : `Status: ${(event as Extract<ParsedEvent, { type: 'status_change' }>).status}`,
          data: { sessionId, eventType: event.type },
        });
      }

      if (compressor.needsCompaction(sessionId)) {
        compressor.compact(sessionId);
      }
    });

    if (!watchers.has(body.projectPath)) {
      const watcher = new FileWatcher({ projectPath: body.projectPath });
      watcher.onFileChange((event: ParsedEvent) => {
        const msg: DaemonMessage = { type: 'parsed_event', sessionId, event };
        // transport.broadcast also forwards to the relay sink — no separate
        // relayConnection.send needed anymore.
        transport.broadcast(msg);
      });
      watchers.set(body.projectPath, watcher);
      // chokidar's initial traversal is CPU-bound and synchronous per entry; on
      // very large trees (100k+ files — e.g. a project with a big build dir or
      // vendored deps) it stalls the event loop and freezes HTTP/WS, which
      // surfaces as the agent appearing "unlinked" from the app. file_change
      // events are a non-essential nicety, so default to OFF and let the user
      // opt in per-project via BATON_WATCH=1 when they know the tree is small.
      if (process.env.BATON_WATCH === '1') {
        setImmediate(() => watcher.start());
      } else {
        console.log(
          `[watcher] file-change watch disabled for ${body.projectPath} (set BATON_WATCH=1 to enable; large trees can freeze the daemon)`,
        );
      }
    }

    return c.json({ sessionId, agentType: body.agentType, status: 'running' });
  });

  function syncActiveAgents(): void {
    analytics.setActiveAgents(agentManager.list().filter((a) => a.status !== 'stopped').length);
  }

  app.post('/api/agents/:id/stop', async (c) => {
    const id = c.req.param('id');
    await agentManager.stop(id);
    compressor.clear(id);
    syncActiveAgents();
    transport.handleSessionStopped(id);
    return c.json({ ok: true });
  });

  app.get('/api/agents', (c) => {
    return c.json(agentManager.list());
  });

  // Persistent session directory — live + past sessions from the store,
  // newest activity first. This is the source of truth for "session history"
  // views; /api/agents above remains the live-only list (stable contract).
  app.get('/api/sessions', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const includeArchived = c.req.query('includeArchived') === '1';
    const archivedOnly = c.req.query('archivedOnly') === '1';
    const projectPath = c.req.query('projectPath') ?? undefined;
    return c.json(agentManager.listSessions({ limit, offset, includeArchived, archivedOnly, projectPath }));
  });

  // Resume a stopped session: spawns a new Baton session continuing the
  // provider-side conversation (exact id when captured, else "latest").
  app.post('/api/agents/:id/resume', async (c) => {
    const id = c.req.param('id');
    const agent = agentManager.get(id);
    if (!agent) return c.json({ error: 'Not found' }, 404);
    if (agent.type === 'acp') {
      return c.json({ error: 'Resume is not supported for generic ACP providers' }, 400);
    }
    const adapter = createAdapter(agent.type, 'pty');
    if (!adapter.detect(agent.projectPath)) {
      return c.json(
        { error: `${agent.type} CLI not found on this host — cannot resume` },
        400,
      );
    }
    try {
      const sessionId = await agentManager.resumeAgent(id, adapter);
      transport.registerSessionEvents(sessionId);
      syncActiveAgents();
      return c.json({ sessionId, resumedFrom: id });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to resume session' },
        409,
      );
    }
  });

  app.delete('/api/agents/:id', async (c) => {
    try {
      await agentManager.delete(c.req.param('id'));
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to delete session' },
        404,
      );
    }
  });

  app.post('/api/agents/:id/archive', async (c) => {
    try {
      await agentManager.archive(c.req.param('id'));
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to archive session' },
        404,
      );
    }
  });

  app.post('/api/agents/:id/unarchive', async (c) => {
    try {
      await agentManager.unarchive(c.req.param('id'));
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to unarchive session' },
        404,
      );
    }
  });

  app.patch('/api/agents/:id', async (c) => {
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
    try {
      agentManager.setTitle(c.req.param('id'), body.title);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to rename session' },
        404,
      );
    }
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
    const rawDir = c.req.query('path') ?? '/';
    const dir = resolve(rawDir);

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

  app.get('/api/files/search', async (c) => {
    const rawDir = c.req.query('path');
    if (!rawDir) return c.json({ error: 'path is required' }, 400);
    const query = (c.req.query('q') ?? '').trim().toLowerCase();
    const dir = resolve(rawDir);
    // Search walks a whole tree recursively (git ls-files / deep scan), so unlike
    // the one-level directory browser it is scoped to registered project paths.
    if (!isPathAllowed(dir)) return c.json({ error: 'Path not allowed' }, 403);

    try {
      const s = await stat(dir);
      if (!s.isDirectory()) {
        return c.json({ error: 'Path is not a directory' }, 400);
      }
      // 1. Try git ls-files if inside a git repository
      const proc = Bun.spawn(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      let filePaths: string[] = [];
      if (exitCode === 0 && stdout.trim().length > 0) {
        filePaths = stdout.trim().split('\n');
      } else {
        // Fallback: fast recursive scan (up to depth 4, skip hidden & node_modules)
        const scan = async (curDir: string, relPrefix = '', depth = 0): Promise<string[]> => {
          if (depth > 4) return [];
          const res: string[] = [];
          const entries = await readdir(curDir, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
            const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
              res.push(...(await scan(join(curDir, e.name), rel, depth + 1)));
            } else {
              res.push(rel);
            }
            if (res.length > 500) break;
          }
          return res;
        };
        filePaths = await scan(dir);
      }

      // Filter and rank by query
      let matches = filePaths;
      if (query) {
        matches = filePaths
          .filter((p) => p.toLowerCase().includes(query))
          .sort((a, b) => {
            const aName = a.split('/').pop()?.toLowerCase() ?? '';
            const bName = b.split('/').pop()?.toLowerCase() ?? '';
            const aNameStarts = aName.startsWith(query);
            const bNameStarts = bName.startsWith(query);
            if (aNameStarts && !bNameStarts) return -1;
            if (!aNameStarts && bNameStarts) return 1;
            const aNameMatch = aName.includes(query);
            const bNameMatch = bName.includes(query);
            if (aNameMatch && !bNameMatch) return -1;
            if (!aNameMatch && bNameMatch) return 1;
            return a.length - b.length;
          });
      }

      return c.json({
        path: dir,
        files: matches.slice(0, 30),
      });
    } catch {
      return c.json({ error: 'Search failed', files: [] }, 400);
    }
  });

  app.get('/api/files/content', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(filePath)) {
      return c.json({ error: 'Path not allowed' }, 403);
    }

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

  const RAW_MIME: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  app.get('/api/files/raw', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(filePath)) {
      return c.json({ error: 'Path not allowed' }, 403);
    }

    try {
      const s = await stat(filePath);
      if (s.isDirectory()) return c.json({ error: 'Path is a directory' }, 400);
      if (s.size > 10 * 1024 * 1024) return c.json({ error: 'File too large (max 10MB)' }, 400);

      const ext = extname(filePath).toLowerCase();
      const contentType = RAW_MIME[ext] ?? 'application/octet-stream';

      const data = await readFile(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(s.size),
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      return c.json({ error: 'Cannot read file' }, 400);
    }
  });

  // Git RPC API
  app.get('/api/git/status', async (c) => {
    const projectPath = c.req.query('path');
    if (!projectPath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.status(projectPath));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git status failed' }, 500);
    }
  });

  app.post('/api/git/commit', async (c) => {
    const body = await c.req.json<{ projectPath: string; message?: string; all?: boolean }>();
    if (!isPathAllowed(body.projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.commit(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git commit failed' }, 500);
    }
  });

  app.post('/api/git/push', async (c) => {
    const { projectPath } = await c.req.json<{ projectPath: string }>();
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    return c.json(await gitService.push(projectPath));
  });

  app.post('/api/git/pull', async (c) => {
    const { projectPath } = await c.req.json<{ projectPath: string }>();
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    return c.json(await gitService.pull(projectPath));
  });

  app.get('/api/git/branches', async (c) => {
    const projectPath = c.req.query('path');
    if (!projectPath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.branches(projectPath));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git branches failed' }, 500);
    }
  });

  app.post('/api/git/checkout', async (c) => {
    const body = await c.req.json<{ projectPath: string; branch: string }>();
    if (!isPathAllowed(body.projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.checkout(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git checkout failed' }, 500);
    }
  });

  app.post('/api/git/create-branch', async (c) => {
    const body = await c.req.json<{ projectPath: string; branch: string; checkout?: boolean }>();
    if (!isPathAllowed(body.projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.createBranch(body));
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Git create branch failed' },
        500,
      );
    }
  });

  app.get('/api/git/log', async (c) => {
    const projectPath = c.req.query('path');
    if (!projectPath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    const count = parseInt(c.req.query('count') ?? '25', 10);
    return c.json(await gitService.log(projectPath, count));
  });

  app.post('/api/git/stash', async (c) => {
    const { projectPath } = await c.req.json<{ projectPath: string }>();
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    return c.json(await gitService.stash(projectPath));
  });

  app.post('/api/git/stash-pop', async (c) => {
    const { projectPath } = await c.req.json<{ projectPath: string }>();
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    return c.json(await gitService.stashPop(projectPath));
  });

  app.get('/api/git/remote-url', async (c) => {
    const projectPath = c.req.query('path');
    if (!projectPath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.remoteUrl(projectPath));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git remote-url failed' }, 500);
    }
  });

  app.get('/api/git/diff', async (c) => {
    const projectPath = c.req.query('path');
    if (!projectPath) return c.json({ error: 'Missing path' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      const file = c.req.query('file') || undefined;
      const staged = c.req.query('staged') === 'true';
      return c.json(await gitService.diff(projectPath, file, staged));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git diff failed' }, 500);
    }
  });

  app.get('/api/git/commit-diff', async (c) => {
    const projectPath = c.req.query('path');
    const hash = c.req.query('hash');
    if (!projectPath || !hash) return c.json({ error: 'Missing path or hash' }, 400);
    if (!isPathAllowed(projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await gitService.commitDiff(projectPath, hash));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Git commit-diff failed' }, 500);
    }
  });

  // Forge API (code-hosting platforms — GitHub, later GitLab/Gitea)
  // Resolve a `repo` (owner/name, full URL, or scp-ssh remote) to a forge
  // service via the open registry. Returns null + the caller-facing reason.
  async function resolveForge(repoParam: string | undefined) {
    if (!repoParam) return { error: 'Missing repo', status: 400 as const };
    const ref = parseRepoRef(repoParam);
    if (!ref) return { error: 'Unrecognized repo (expected owner/name, URL, or ssh remote)', status: 400 as const };
    const forge = await forgeRegistry.resolveHost(ref.host);
    if (!forge) return { error: `No forge adapter for host ${ref.host}`, status: 400 as const };
    const service = forgeRegistry.create(forge);
    if (!service) return { error: `Forge ${forge} not available`, status: 500 as const };
    return { ref, service };
  }

  app.get('/api/forge/prs', async (c) => {
    const resolved = await resolveForge(c.req.query('repo'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    try {
      const state = c.req.query('state') || undefined;
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
      return c.json(await resolved.service.listPullRequests(resolved.ref, { state, limit }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Forge list PRs failed' }, 500);
    }
  });

  app.get('/api/forge/issues', async (c) => {
    const resolved = await resolveForge(c.req.query('repo'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    try {
      const state = c.req.query('state') || undefined;
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
      return c.json(await resolved.service.listIssues(resolved.ref, { state, limit }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Forge list issues failed' }, 500);
    }
  });

  app.get('/api/forge/pr/:number/checks', async (c) => {
    const resolved = await resolveForge(c.req.query('repo'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    const prNumber = parseInt(c.req.param('number'), 10);
    if (!Number.isFinite(prNumber)) return c.json({ error: 'Invalid PR number' }, 400);
    try {
      return c.json(await resolved.service.getChecks(resolved.ref, prNumber));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Forge checks failed' }, 500);
    }
  });

  app.get('/api/forge/pr/:number/checkout-target', async (c) => {
    const resolved = await resolveForge(c.req.query('repo'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    const prNumber = parseInt(c.req.param('number'), 10);
    if (!Number.isFinite(prNumber)) return c.json({ error: 'Invalid PR number' }, 400);
    try {
      return c.json(await resolved.service.getCheckoutTarget(resolved.ref, prNumber));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Forge checkout-target failed' }, 500);
    }
  });

  // Check out a PR into a local working tree (fork-aware). Writes to the tree,
  // so the projectPath must be an allowed path.
  app.post('/api/forge/pr/:number/checkout', async (c) => {
    const body = await c.req.json<{ repo?: string; projectPath?: string }>().catch(() => ({}) as {
      repo?: string;
      projectPath?: string;
    });
    if (!body.projectPath) return c.json({ error: 'Missing projectPath' }, 400);
    if (!isPathAllowed(body.projectPath)) return c.json({ error: 'Path not allowed' }, 403);
    const resolved = await resolveForge(body.repo);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    const prNumber = parseInt(c.req.param('number'), 10);
    if (!Number.isFinite(prNumber)) return c.json({ error: 'Invalid PR number' }, 400);
    try {
      const target = await resolved.service.getCheckoutTarget(resolved.ref, prNumber);
      return c.json(await checkoutPullRequest(body.projectPath, target));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Forge checkout failed' }, 500);
    }
  });

  // Worktree API (parallel git worktrees for isolated agent branches)
  app.get('/api/worktree/list', async (c) => {
    const status = c.req.query('status');
    try {
      const all = await listWorktrees(
        status === 'active' || status === 'archived' ? status : undefined,
      );
      return c.json(all);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Worktree list failed' },
        500,
      );
    }
  });

  app.post('/api/worktree/create', async (c) => {
    const body = await c.req
      .json<{ basePath?: string; branch?: string }>()
      .catch(() => ({}) as { basePath?: string; branch?: string });
    if (!body.basePath || !body.branch) {
      return c.json({ error: 'Missing basePath or branch' }, 400);
    }
    if (!isPathAllowed(body.basePath)) return c.json({ error: 'Path not allowed' }, 403);
    try {
      return c.json(await createWorktree(body.basePath, body.branch));
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Worktree create failed' },
        500,
      );
    }
  });

  app.post('/api/worktree/archive', async (c) => {
    const body = await c.req
      .json<{ path?: string }>()
      .catch(() => ({}) as { path?: string });
    if (!body.path) return c.json({ error: 'Missing path' }, 400);
    try {
      const result = await archiveWorktree(body.path);
      if (!result) return c.json({ error: 'Worktree not found or already archived' }, 404);
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Worktree archive failed' },
        500,
      );
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
      type: body.type as ProviderProfile['type'],
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

  // Generic ACP providers ($BATON_HOME/acp.json). Reloads on every call so
  // config edits appear without a daemon restart, and refreshes adapter
  // instances so the next start request finds them warm.
  app.get('/api/acp/providers', async (c) => {
    const profiles = await loadAcpProviders();
    refreshAcpAdapters(profiles);
    return c.json(
      [...profiles.entries()].map(([name, p]) => ({
        name,
        label: p.label ?? name,
        command: p.command,
        available: acpProviderAvailable(p),
      })),
    );
  });

  // API Providers — managed here, synced into Codex's config.toml on every write
  const apiProviderRegistry = new ApiProviderRegistry();
  apiProviderRegistry.setPort(port);

  app.get('/api/api-providers', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    return c.json(apiProviderRegistry.list());
  });

  app.get('/api/api-providers/default', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const provider = apiProviderRegistry.getDefault();
    if (!provider) return c.json({ error: 'No provider configured' }, 404);
    return c.json(provider);
  });

  // NOTE: must be declared before the `/:name` route or it gets shadowed.
  app.get('/api/api-providers/codex-preview', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const config: ApiProviderConfig = { providers: {} };
    for (const p of apiProviderRegistry.list()) {
      const { name, ...profile } = p;
      config.providers[name] = profile;
    }
    return c.json({ toml: previewCodexProviders(config, port) });
  });

  app.get('/api/api-providers/:name', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const profile = apiProviderRegistry.get(c.req.param('name'));
    if (!profile) return c.json({ error: 'Provider not found' }, 404);
    return c.json({ name: c.req.param('name'), ...profile });
  });

  app.post('/api/api-providers', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const body = await c.req.json<{
      name: string;
      baseUrl: string;
      envKey?: string;
      models?: string[];
      enabled?: boolean;
      isDefault?: boolean;
      apiMode?: 'responses' | 'chat' | 'chat-completions';
      upstreamFormat?: 'responses' | 'openai-chat' | 'anthropic';
    }>();

    const upstreamFormat = body.upstreamFormat ?? 'openai-chat';
    const envKey = body.envKey ?? 'OPENAI_API_KEY';
    if (!API_KEY_ENV_PATTERN.test(envKey)) {
      return c.json({ error: 'envKey must be an env var name ending in _API_KEY' }, 400);
    }
    // The proxy later fetches this URL server-side — only http(s) origins are
    // acceptable (blocks file:, data: and other schemes at the boundary).
    try {
      const u = new URL(body.baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad scheme');
    } catch {
      return c.json({ error: 'baseUrl must be a valid http(s) URL' }, 400);
    }
    const profile: ApiProviderProfile = {
      baseUrl: body.baseUrl,
      envKey,
      models: body.models ?? [],
      enabled: body.enabled ?? true,
      isDefault: body.isDefault ?? false,
      // apiMode follows upstreamFormat: responses↔responses, chat↔openai-chat.
      // Most third-party OpenAI-compatible providers only expose /chat/completions,
      // so defaulting to openai-chat avoids the common /responses 404 trap.
      apiMode: (body.apiMode ?? (upstreamFormat === 'responses' ? 'responses' : 'chat')) as
        | 'responses'
        | 'chat',
      upstreamFormat,
      createdAt: new Date().toISOString(),
    };

    await apiProviderRegistry.set(body.name, profile);
    return c.json({ ok: true }, 201);
  });

  app.put('/api/api-providers/:name', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const name = c.req.param('name');
    const existing = apiProviderRegistry.get(name);
    if (!existing) return c.json({ error: 'Provider not found' }, 404);

    const body = await c.req.json<Partial<ApiProviderProfile>>();
    if (body.envKey !== undefined && !API_KEY_ENV_PATTERN.test(body.envKey)) {
      return c.json({ error: 'envKey must be an env var name ending in _API_KEY' }, 400);
    }
    if (body.baseUrl !== undefined) {
      try {
        const u = new URL(body.baseUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad scheme');
      } catch {
        return c.json({ error: 'baseUrl must be a valid http(s) URL' }, 400);
      }
    }
    await apiProviderRegistry.set(name, { ...existing, ...body });
    return c.json({ ok: true });
  });

  app.delete('/api/api-providers/:name', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();
    const removed = await apiProviderRegistry.remove(c.req.param('name'));
    if (!removed) return c.json({ error: 'Provider not found' }, 404);
    return c.json({ ok: true });
  });

  // Preview the [model_providers.*] TOML that would be written to Codex's
  // config.toml, for display in the API Providers UI.
  // ── Protocol-adapting proxy ──────────────────────────────────────────
  // Codex (wire_api = "responses") POSTs Responses-API requests here. The
  // daemon adapts the request to the target provider's `upstreamFormat`,
  // forwards it to the provider's real baseUrl, and adapts the reply back.
  app.post('/proxy/responses', async (c) => {
    if (!apiProviderRegistry.ensureLoaded()) await apiProviderRegistry.load();

    const requestedProvider = c.req.header('X-Provider');
    const provider = requestedProvider
      ? apiProviderRegistry.get(requestedProvider)
      : apiProviderRegistry.getDefault();

    if (!provider || !provider.enabled) {
      return c.json({ error: 'No API provider configured' }, 500);
    }

    const apiKey = resolveApiKey(provider);
    if (!apiKey) {
      return c.json(
        { error: `Environment variable ${provider.envKey} is not set; cannot resolve API key` },
        500,
      );
    }

    const req = (await c.req.json()) as ResponsesApiRequest;
    // Reviewed 2026-10-06: local daemon proxying user-configured providers.
    // /proxy/* is localOnly-guarded; baseUrl is validated HERE and at the
    // fetch boundary (proxy.ts) — provider create/update paths never feed it.
    let baseUrl: URL;
    try {
      baseUrl = new URL(provider.baseUrl);
    } catch {
      return c.json({ error: 'Provider baseUrl is not a valid URL' }, 400);
    }
    if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
      return c.json({ error: 'Provider baseUrl must be http(s)' }, 400);
    }
    const result = await proxyResponses(req, {
      baseUrl: baseUrl.toString(),
      apiKey,
      upstreamFormat: provider.upstreamFormat ?? 'responses',
    });

    if ('error' in result) {
      return c.json({ error: result.error }, result.status as 400 | 401 | 403 | 404 | 429 | 500);
    }

    if ('stream' in result) {
      return new Response(result.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    return c.json(result.json);
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

  // ── Schedules (cron-triggered agents) ─────────────────────────────
  app.get('/api/schedules', (c) => {
    return c.json(scheduler.list());
  });

  app.post('/api/schedules', async (c) => {
    const body = await c.req.json<{
      name: string;
      cron: string;
      agentType: string;
      projectPath: string;
      prompt: string;
      enabled?: boolean;
    }>();
    try {
      const schedule = scheduler.add({
        name: body.name,
        cron: body.cron,
        agentType: body.agentType,
        projectPath: body.projectPath,
        prompt: body.prompt,
        enabled: body.enabled ?? true,
      });
      return c.json(schedule, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid schedule' }, 400);
    }
  });

  app.delete('/api/schedules/:id', (c) => {
    const removed = scheduler.remove(c.req.param('id'));
    if (!removed) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  app.post('/api/schedules/:id/enable', (c) => {
    scheduler.enable(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/schedules/:id/disable', (c) => {
    scheduler.disable(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ── Workspace checkpoints (undo AI changes) ───────────────────────
  app.get('/api/workspace/checkpoints', async (c) => {
    const projectPath = c.req.query('cwd');
    if (!projectPath) return c.json({ error: 'cwd query param required' }, 400);
    if (!isPathAllowed(resolve(projectPath))) {
      return c.json({ error: 'Path not allowed' }, 403);
    }
    const checkpoints = await checkpointService.list(projectPath);
    return c.json(checkpoints);
  });

  app.post('/api/workspace/checkpoint', async (c) => {
    const body = await c.req.json<{ cwd: string; label?: string }>();
    if (!body.cwd) return c.json({ error: 'cwd required' }, 400);
    if (!isPathAllowed(resolve(body.cwd))) {
      return c.json({ error: 'Path not allowed' }, 403);
    }
    try {
      const cp = await checkpointService.create(body.cwd, body.label ?? 'Manual checkpoint');
      return c.json(cp, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Checkpoint failed' }, 500);
    }
  });

  // Checkpoint ids are `cp_<base36>_<base36>` (checkpoint.ts create) — the
  // guard keeps client-supplied ids from escaping the checkpoints dir via
  // path traversal before they ever reach a file path or git call.
  const isCheckpointId = (id: unknown): id is string =>
    typeof id === 'string' && /^cp_[a-z0-9]+_[a-z0-9]+$/i.test(id);

  app.post('/api/workspace/revert-preview', async (c) => {
    const body = await c.req.json<{ cwd: string; checkpointId: string }>();
    if (!body?.cwd) return c.json({ error: 'cwd required' }, 400);
    if (!isPathAllowed(resolve(body.cwd))) {
      return c.json({ error: 'Path not allowed' }, 403);
    }
    if (!isCheckpointId(body.checkpointId)) {
      return c.json({ error: 'Invalid checkpoint id' }, 400);
    }
    try {
      // cwd is isPathAllowed-guarded and realpath-canonicalized in the
      // service; checkpointId passed the format gate above; git runs via
      // arg-array spawn with the patch on stdin.
      const preview = await checkpointService.revertPreview(body.cwd, body.checkpointId);
      return c.json(preview);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
    }
  });

  app.post('/api/workspace/revert-apply', async (c) => {
    const body = await c.req.json<{ cwd: string; checkpointId: string }>();
    if (!body?.cwd) return c.json({ error: 'cwd required' }, 400);
    if (!isPathAllowed(resolve(body.cwd))) {
      return c.json({ error: 'Path not allowed' }, 403);
    }
    if (!isCheckpointId(body.checkpointId)) {
      return c.json({ error: 'Invalid checkpoint id' }, 400);
    }
    try {
      // Same guard chain as revert-preview above.
      await checkpointService.revertApply(body.cwd, body.checkpointId);
      return c.json({ ok: true });
      } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Revert failed' }, 500);
    }
  });

  app.delete('/api/workspace/checkpoints/:id', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ error: 'cwd query param required' }, 400);
    if (!isPathAllowed(resolve(cwd))) {
      return c.json({ error: 'Path not allowed' }, 403);
    }
    const id = c.req.param('id');
    if (!isCheckpointId(id)) {
      return c.json({ error: 'Invalid checkpoint id' }, 400);
    }
    const removed = await checkpointService.remove(cwd, id);
    if (!removed) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Web Push VAPID public key ─────────────────────────────────────
  // Browsers need this to create a PushSubscription via
  // pushManager.subscribe({ applicationServerKey: <publicKey> }).
  app.get('/api/push/vapid-public', async (c) => {
    const keys = await getVapidKeys();
    return c.json({ publicKey: keys.publicKey });
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
        // Messages from remote clients — full ClientMessage surface, handled
        // by the transport (input, attach/detach/resume, stop). Replies and
        // session streams flow back via the relay sink wired below.
        if ('type' in msg) {
          transport.handleRelayMessage(msg as unknown as ClientMessage);
        }
      },
      onStatusChange: (connected) => {
        console.log(`Relay: ${connected ? 'connected' : 'disconnected'}`);
        if (!connected) transport.attachRelaySink(null);
      },
    });
    // Session streams + broadcasts reach remote clients through this sink.
    transport.attachRelaySink((m) => relayConnection?.send(m));

    relayConnection.connect();
    return c.json({ hostId, status: 'connecting' });
  });

  app.post('/api/relay/disconnect', (c) => {
    relayConnection?.disconnect();
    relayConnection = null;
    transport.attachRelaySink(null);
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
    const ips = getLocalIps();
    const localIp = ips.ipv4 || '127.0.0.1';
    const localHttpUrl = `http://${localIp}:${port}`;
    const localWsUrl = `ws://${localIp}:${port + 1}`;
    const hostname = os.hostname();
    const payload = JSON.stringify({
      version: 1,
      name: hostname,
      localHttpUrl,
      localWsUrl,
      daemonId: 'local',
      fp: fingerprint,
      relay: relayUrl,
    });
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 256 });
    const qrTerminal = await QRCode.toString(payload, { type: 'terminal', small: true });
    return c.json({
      qr: qrDataUrl,
      qrTerminal,
      fingerprint,
      relayUrl,
      localHttpUrl,
      localWsUrl,
      name: hostname,
      payload,
    });
  });

  return { app, agentManager, transport, port, watchers };
}

export async function main() {
  // Load ~/.baton/.env as a fallback so API keys are available no matter how
  // the daemon was launched (terminal / mobile pairing / launchd / reboot).
  // Existing process.env values win. Must run before createDaemon().
  try {
    const { loaded } = await loadBatonEnv();
    if (loaded > 0) console.log(`[baton] loaded ${loaded} env var(s) from ~/.baton/.env`);
  } catch {
    // Non-fatal — env loading must never block daemon startup.
  }

  // Load third-party provider plugins from ~/.baton/plugins/. Each broken
  // plugin is skipped with a log line; never blocks startup.
  try {
    const { loadProviderPlugins } = await import('./plugins/loader.js');
    const plugins = await loadProviderPlugins();
    for (const p of plugins.loaded) {
      console.log(`[baton] plugin loaded: ${p.name} (${p.type})`);
    }
    for (const f of plugins.failed) {
      console.warn(`[baton] plugin skipped: ${f.name} — ${f.reason}`);
    }
  } catch (err) {
    console.warn('[baton] plugin loading failed:', err instanceof Error ? err.message : err);
  }

  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  // Write our PID so `baton daemon stop/status` and companions can find us.
  // Refuses to start if a live daemon is already running on this host —
  // before any port is bound, so a refused duplicate never prints
  // "listening" banners (and a dying `--watch` predecessor is reclaimed
  // inside acquirePid's grace window).
  try {
    await acquirePid();
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      console.error(`\n  ✗ ${err.message}`);
      console.error(`    Run \`baton daemon stop\` first, or remove ${err.pidfile} if stale.\n`);
      process.exit(1);
    }
    throw err;
  }

  const { app, transport } = createDaemon(port);

  transport.start();

  const hostname = process.env.HOST || '::';
  const displayHost = formatHostForUrl(hostname);

  Bun.serve({
    // Expose the socket peer address to handlers (c.env.requestIP) — used by
    // the local-only guard. Never trust X-Forwarded-For for this.
    fetch: (req, server) => app.fetch(req, { requestIP: server.requestIP(req)?.address }),
    port,
    hostname,
  });

  const localIps = getLocalIps();
  console.log(`\n  Baton Daemon v${BATON_VERSION}`);
  console.log(`  HTTP:      http://${displayHost}:${port}`);
  console.log(`  WebSocket: ws://${displayHost}:${port + 1}`);
  if (hostname === '::') {
    if (localIps.ipv4) {
      console.log(`  LAN HTTP:  http://${localIps.ipv4}:${port}`);
      console.log(`  LAN WS:    ws://${localIps.ipv4}:${port + 1}`);
    }
    if (localIps.ipv6) {
      console.log(`  LAN HTTP:  http://[${localIps.ipv6}]:${port}`);
      console.log(`  LAN WS:    ws://[${localIps.ipv6}]:${port + 1}`);
    }
  }
  console.log(`  Host: ${os.hostname()} (${process.platform})\n`);

  process.on('SIGINT', () => {
    transport.stop();
    void releasePid().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    transport.stop();
    void releasePid().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  void main();
}

