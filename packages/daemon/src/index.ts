import os from 'node:os';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, extname, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import { generateKeyPair, keyToFingerprint } from '@baton/shared/crypto';
import { AgentManager } from './agent/manager.js';
import { createAdapter, createSdkAdapter, ProviderRegistry } from './agent/index.js';
import { Transport } from './transport/index.js';
import { RelayConnection } from './transport/relay.js';
import { FileWatcher } from './watcher/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { ScheduleService } from './scheduler/schedule.js';
import { WorkspaceCheckpointService } from './workspace/checkpoint.js';
import { getVapidKeys } from './system/vapid.js';
import { AnalyticsService } from './system/analytics.js';
import { PushNotificationService } from './system/push.js';
import { ContextCompressor } from './parser/compressor.js';
import { GitService } from './git/index.js';
import { ApiProviderRegistry } from './api-converter/index.js';
import { proxyResponses, resolveApiKey } from './api-converter/proxy.js';
import { previewCodexProviders } from './api-converter/codex-sync.js';
import { loadBatonEnv } from './env.js';
import type { ResponsesApiRequest } from './api-converter/types.js';
import { acquirePid, releasePid, DaemonAlreadyRunningError } from '@baton/shared';
import type { PipelineStep } from './orchestrator/index.js';
import type {
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

export function createDaemon(port = DEFAULT_PORT) {
  const app = new Hono();
  const batonHome = process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  const agentManager = new AgentManager();
  const orchestrator = new Orchestrator(agentManager);
  const scheduler = new ScheduleService(agentManager);
  void scheduler.restore();
  const checkpointService = new WorkspaceCheckpointService();
  const analytics = new AnalyticsService(join(batonHome, 'analytics.db'));
  const pushService = new PushNotificationService();
  const compressor = new ContextCompressor();
  const gitService = new GitService();
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
    return allowedProjectPaths.size === 0;
  }

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

    // SDK mode: try the SDK adapter first; fall back to PTY if unavailable.
    const sdkAdapter = createSdkAdapter(body.agentType);
    const wantSdk =
      (body.mode ?? 'pty') === 'sdk' || (body.mode === 'auto' && !!sdkAdapter?.isSdkAvailable());
    let sessionId: string;
    if (wantSdk && sdkAdapter) {
      sessionId = await agentManager.startSdk(agentConfig, sdkAdapter);
    } else {
      const adapter = createAdapter(body.agentType, body.mode ?? 'pty');
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
        transport.broadcast(msg);
        relayConnection?.send(msg);
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
    if (!isPathAllowed(dir)) {
      return c.json({ error: 'Path not allowed' }, 403);
    }

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
      type: body.type as 'claude-code' | 'codex' | 'opencode' | 'kiro-cli' | 'custom',
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
    const profile: ApiProviderProfile = {
      baseUrl: body.baseUrl,
      envKey: body.envKey ?? 'OPENAI_API_KEY',
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
    const result = await proxyResponses(req, {
      baseUrl: provider.baseUrl,
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
    const checkpoints = await checkpointService.list(projectPath);
    return c.json(checkpoints);
  });

  app.post('/api/workspace/checkpoint', async (c) => {
    const body = await c.req.json<{ cwd: string; label?: string }>();
    if (!body.cwd) return c.json({ error: 'cwd required' }, 400);
    try {
      const cp = await checkpointService.create(body.cwd, body.label ?? 'Manual checkpoint');
      return c.json(cp, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Checkpoint failed' }, 500);
    }
  });

  app.post('/api/workspace/revert-preview', async (c) => {
    const body = await c.req.json<{ cwd: string; checkpointId: string }>();
    try {
      const preview = await checkpointService.revertPreview(body.cwd, body.checkpointId);
      return c.json(preview);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
    }
  });

  app.post('/api/workspace/revert-apply', async (c) => {
    const body = await c.req.json<{ cwd: string; checkpointId: string }>();
    try {
      await checkpointService.revertApply(body.cwd, body.checkpointId);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Revert failed' }, 500);
    }
  });

  app.delete('/api/workspace/checkpoints/:id', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ error: 'cwd query param required' }, 400);
    const removed = await checkpointService.remove(cwd, c.req.param('id'));
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
  // Load ~/.baton/.env as a fallback so API keys are available no matter how
  // the daemon was launched (terminal / mobile pairing / launchd / reboot).
  // Existing process.env values win. Must run before createDaemon().
  try {
    const { loaded } = await loadBatonEnv();
    if (loaded > 0) console.log(`[baton] loaded ${loaded} env var(s) from ~/.baton/.env`);
  } catch {
    // Non-fatal — env loading must never block daemon startup.
  }

  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const { app, transport } = createDaemon(port);

  transport.start();

  const hostname = process.env.HOST || '::';
  const displayHost = formatHostForUrl(hostname);

  // Write our PID so `baton daemon stop/status` and companions can find us.
  // Refuses to start if a live daemon is already running on this host.
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

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  const localIps = getLocalIps();
  console.log(`\n  Baton Daemon v0.0.1`);
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

main();
