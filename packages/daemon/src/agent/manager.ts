import type {
  AgentConfig,
  AgentProcess,
  ParsedEvent,
  SdkAgentAdapter,
  ThinkingConfig,
  ReasoningEffort,
  AccessMode,
  ServiceTier,
} from '@baton/shared';
import { VALID_TRANSITIONS, generateSessionId } from '@baton/shared';
import type { AgentState, AgentSnapshot, SessionSummary, TimelineItem } from '@baton/shared';
import type { BaseAgentAdapter } from './adapter.js';
import { spawnPty } from '../pty/bridge.js';
import { SessionStore, deriveTitle } from '../session/store.js';
import { readdir, stat, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';

interface IPty {
  pid: number;
  kill(signal?: string): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

interface SdkSession {
  write: (input: string) => void;
  stop: () => Promise<void>;
}

interface ManagedAgent {
  process: AgentProcess;
  adapter: BaseAgentAdapter | null;
  pty: IPty | null;
  sdk: SdkSession | null;
  sdkAdapter: SdkAgentAdapter | null;
  state: AgentState;
  cols: number;
  rows: number;
  outputHistory: string[];
  displayHistory: string[];
  eventHistory: ParsedEvent[];
  timeline: TimelineItem[];
  eventCallbacks: Set<(event: ParsedEvent, sessionId: string) => void>;
  rawCallbacks: Set<(data: string, sessionId: string) => void>;
  firstOutputReceived: boolean;
  /**
   * Restored-from-disk dead session: kept so transcripts can still be
   * attached/read, but excluded from list() — otherwise every historical
   * session ever started piles up in the dashboards as "Stopped" rows.
   */
  historyOnly?: boolean;
  /**
   * Transcript buffers dropped from memory (history lives in the SessionStore).
   * Set for stopped agents once they age out of the in-memory retention window.
   */
  offloaded?: boolean;
}

const MAX_OUTPUT_HISTORY = 10000;
const OUTPUT_TRIM_TO = 5000;
const MAX_EVENT_HISTORY = 5000;
const EVENT_TRIM_TO = 2000;
const MAX_TIMELINE = 200;
const DEFAULT_COLS = 140;
const DEFAULT_ROWS = 40;
/** Bounded attach replay: at most this many events / output bytes sent in one
 * go (deep history stays in the store, reachable via GET /api/sessions). */
const ATTACH_EVENT_TAIL = 1000;
const ATTACH_OUTPUT_BYTES = 256 * 1024;
/** Stopped agents whose buffers stay in RAM for instant re-attach; older ones
 * are offloaded to the store. */
const KEEP_STOPPED_BUFFERED = 8;
/** Throttle for persisted lastActivityAt updates on streaming paths. */
const TOUCH_INTERVAL_MS = 2000;

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();
  private store: SessionStore | null = null;
  private lastTouch = new Map<string, number>();
  private changeListeners = new Set<() => void>();
  private notifyPending = false;

  // ── State Machine ──────────────────────────────────────────────

  private transition(
    id: string,
    newStatus: AgentState['status'],
    meta?: Record<string, unknown>,
  ): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);

    const currentStatus = managed.state.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid state transition: ${currentStatus} → ${newStatus}`);
    }

    const at = Date.now();

    switch (newStatus) {
      case 'initializing':
        managed.state = { status: 'initializing', at };
        break;
      case 'idle':
        managed.state = { status: 'idle', at, lastActivity: at };
        break;
      case 'running':
        managed.state = { status: 'running', at, toolCount: (meta?.toolCount as number) ?? 0 };
        break;
      case 'waiting_input':
        managed.state = { status: 'waiting_input', at, prompt: (meta?.prompt as string) ?? '' };
        break;
      case 'error':
        managed.state = {
          status: 'error',
          at,
          error: (meta?.error as string) ?? 'Unknown error',
          code: meta?.code as number | undefined,
        };
        break;
      case 'stopped':
        managed.state = { status: 'stopped', at, exitCode: (meta?.exitCode as number) ?? 0 };
        break;
    }

    // Sync to AgentProcess for backward compat
    managed.process.status = newStatus as AgentProcess['status'];

    // Add to timeline
    this.pushTimeline(managed, newStatus, `State: ${newStatus}`);

    // Emit status change event
    const event: ParsedEvent = {
      type: 'status_change',
      status: newStatus as AgentProcess['status'],
      timestamp: at,
    };
    managed.eventHistory.push(event);
    this.sessionStore.appendEvent(id, event);
    for (const cb of managed.eventCallbacks) cb(event, id);

    // Persist to the session store (synchronous SQLite, cheap)
    this.sessionStore.patchSession(id, {
      status: newStatus as AgentProcess['status'],
      updatedAt: new Date(at).toISOString(),
      ...(newStatus === 'stopped' || newStatus === 'error'
        ? {
            stoppedAt: new Date(at).toISOString(),
            exitCode: (meta?.exitCode as number) ?? (newStatus === 'error' ? 1 : 0),
          }
        : {}),
    });
    this.notifyChanged();
  }

  private pushTimeline(managed: ManagedAgent, type: string, summary: string): void {
    managed.timeline.push({ timestamp: Date.now(), type: type as TimelineItem['type'], summary });
    if (managed.timeline.length > MAX_TIMELINE) {
      managed.timeline = managed.timeline.slice(-MAX_TIMELINE);
    }
  }

  /**
   * Sync an SDK adapter's reported status into the canonical AgentProcess
   * without re-broadcasting (the caller already forwards the raw event).
   * Terminal states are never left: a late adapter event must not resurrect
   * a stopped/error session.
   */
  private syncSdkStatus(id: string, status: AgentProcess['status']): void {
    const managed = this.agents.get(id);
    if (!managed) return;
    if (managed.state.status === 'stopped' || managed.state.status === 'error') return;
    if (managed.state.status === status) return;
    const at = Date.now();
    switch (status) {
      case 'stopped':
        managed.state = { status: 'stopped', at, exitCode: 0 };
        break;
      case 'error':
        managed.state = { status: 'error', at, error: 'Adapter reported error' };
        break;
      case 'idle':
        managed.state = { status: 'idle', at, lastActivity: at };
        break;
      case 'running':
        managed.state = { status: 'running', at, toolCount: 0 };
        break;
      case 'thinking':
        managed.state = { status: 'thinking', at };
        break;
      case 'executing':
        managed.state = { status: 'executing', at, tool: 'unknown' };
        break;
      case 'waiting_input':
        managed.state = { status: 'waiting_input', at, prompt: '' };
        break;
      default:
        return; // 'starting'/'initializing' are spawn-internal — never synced
    }
    managed.process.status = status;
    this.touch(id, true);
    this.notifyChanged();
  }

  // ── Session store ────────────────────────────────────────────────

  private get sessionStore(): SessionStore {
    if (!this.store) {
      this.store = new SessionStore(join(this.batonHome, 'sessions.db'));
      const pruned = this.store.prune();
      if (pruned.length > 0) {
        console.log(`[SESSION] pruned ${pruned.length} session(s) past retention`);
      }
    }
    return this.store;
  }

  /** Update persisted lastActivityAt, throttled on hot streaming paths. */
  private touch(id: string, force = false): void {
    const now = Date.now();
    const last = this.lastTouch.get(id) ?? 0;
    if (!force && now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(id, now);
    this.sessionStore.patchSession(id, { updatedAt: new Date(now).toISOString() });
  }

  /**
   * Register a listener fired (coalesced per tick) whenever the set or status
   * of sessions changes — the transport uses this to push agent_list to every
   * connected client, so sessions started via HTTP/MCP/scheduler appear on
   * already-open dashboards immediately.
   */
  onAgentsChanged(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private notifyChanged(): void {
    if (this.notifyPending) return;
    this.notifyPending = true;
    queueMicrotask(() => {
      this.notifyPending = false;
      for (const cb of this.changeListeners) cb();
    });
  }

  /** Derive + persist a provisional title from the first user prompt. */
  private maybeTitle(id: string, content: string): void {
    const managed = this.agents.get(id);
    if (!managed || managed.process.title) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const title = deriveTitle(trimmed);
    managed.process.title = title;
    this.sessionStore.patchSession(id, { title });
    this.notifyChanged();
  }

  // ── Persistence ────────────────────────────────────────────────

  private get batonHome(): string {
    return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  }

  /**
   * Session history now lives in the SQLite SessionStore (sessions.db).
   * On first boot after the migration, legacy `$BATON_HOME/agents/<hash>/<id>.json`
   * snapshots are imported (newest 100, matching the old on-disk cap) and the
   * files removed. Live sessions are NOT hydrated into memory — `get()` and the
   * history getters lazily fall back to the store (paseo's lazy-load pattern),
   * so the daemon's baseline memory no longer scales with session count.
   */
  async restore(): Promise<void> {
    const store = this.sessionStore;
    if (store.countSessions() === 0) await this.importLegacySnapshots();
    // Crash recovery: sessions mid-flight when the daemon died are dead.
    const recovered = store.markNonTerminalStopped();
    if (recovered > 0) {
      console.log(`[SESSION] recovered ${recovered} crashed session(s) as stopped`);
    }
  }

  private async importLegacySnapshots(): Promise<void> {
    const agentsDir = join(this.batonHome, 'agents');
    try {
      await access(agentsDir);
    } catch {
      return; // No legacy agents dir — nothing to import
    }

    const HISTORY_CAP = 100;

    try {
      const dirs = await readdir(agentsDir);
      const found: Array<{ path: string; snapshot: AgentSnapshot }> = [];
      for (const dir of dirs) {
        const dirPath = join(agentsDir, dir);
        const s = await stat(dirPath);
        if (!s.isDirectory()) continue;

        const files = await readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const path = join(dirPath, file);
            const snapshot: AgentSnapshot = JSON.parse(await readFile(path, 'utf-8'));
            found.push({ path, snapshot });
          } catch (err) {
            console.error(`Failed to import ${file}:`, err);
          }
        }
      }

      // Newest first (last state transition time, falling back to creation).
      const tsOf = (s: AgentSnapshot): number =>
        (s.state as { at?: number }).at ?? Date.parse(s.createdAt) ?? 0;
      found.sort((a, b) => tsOf(b.snapshot) - tsOf(a.snapshot));

      for (const { snapshot } of found.slice(0, HISTORY_CAP)) {
        // Crashed agents are always stopped after recovery
        const state =
          snapshot.state.status === 'stopped'
            ? snapshot.state
            : { status: 'stopped' as const, at: Date.now(), exitCode: -1 };
        this.sessionStore.upsertSession({
          id: snapshot.id,
          type: snapshot.type,
          projectPath: snapshot.projectPath,
          mode: snapshot.mode ?? 'pty',
          status: 'stopped',
          createdAt: snapshot.createdAt,
        });
        this.sessionStore.patchSession(snapshot.id, {
          status: 'stopped',
          stoppedAt: new Date(state.at).toISOString(),
          exitCode: state.status === 'stopped' ? state.exitCode : -1,
          updatedAt: new Date(state.at).toISOString(),
        });
      }

      // The store owns this data now; remove the legacy files (idempotent — a
      // crash mid-import just re-imports on next boot).
      await Promise.all(found.map((f) => rm(f.path).catch(() => {})));
      if (found.length > 0) {
        console.log(
          `[SESSION] imported ${Math.min(found.length, HISTORY_CAP)} legacy session snapshot(s)`,
        );
      }
    } catch (err) {
      console.error('Failed to import legacy agents:', err);
    }
  }

  // ── Agent Lifecycle ────────────────────────────────────────────

  async start(config: AgentConfig, adapter: BaseAgentAdapter): Promise<string> {
    const id = generateSessionId();
    const spawnConfig = adapter.buildSpawnConfig(config);
    const cols = DEFAULT_COLS;
    const rows = DEFAULT_ROWS;

    const pty = await spawnPty(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env as Record<string, string>,
      cols,
      rows,
    });

    console.log(`[AGENT] Started ${id.slice(0, 8)} type=${config.type} pid=${pty.pid} cwd=${spawnConfig.cwd}`);

    const agentProcess: AgentProcess = {
      id,
      type: config.type,
      projectPath: config.projectPath,
      status: 'starting',
      pid: pty.pid,
      startedAt: new Date().toISOString(),
      mode: 'pty',
    };

    const managed: ManagedAgent = {
      process: agentProcess,
      adapter,
      pty,
      sdk: null,
      sdkAdapter: null,
      state: { status: 'initializing', at: Date.now() },
      cols,
      rows,
      outputHistory: [],
      displayHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: false,
    };

    this.sessionStore.upsertSession(
      {
        id,
        type: config.type,
        projectPath: config.projectPath,
        mode: 'pty',
        status: 'starting',
        createdAt: agentProcess.startedAt,
      },
      pty.pid,
    );

    // PTY output handler
    pty.onData((data: string) => {
      // Store raw output for reconnection replay
      managed.outputHistory.push(data);
      if (managed.outputHistory.length > MAX_OUTPUT_HISTORY) {
        managed.outputHistory = managed.outputHistory.slice(-OUTPUT_TRIM_TO);
      }

      if (!managed.firstOutputReceived) {
        console.log(`[PTY] First output for ${id.slice(0, 8)} (${data.length}b) | rawCallbacks: ${managed.rawCallbacks.size}`);
        managed.firstOutputReceived = true;
        if (managed.state.status === 'initializing') {
          this.transition(id, 'running');
        }
      }

      // Broadcast raw terminal data (adapter may filter for non-terminal protocols)
      const filtered = adapter.filterRawOutput(data);
      if (filtered !== null) {
        managed.displayHistory.push(filtered);
        if (managed.displayHistory.length > MAX_OUTPUT_HISTORY) {
          managed.displayHistory = managed.displayHistory.slice(-OUTPUT_TRIM_TO);
        }
        this.sessionStore.appendOutput(id, filtered);
        this.touch(id);
        for (const cb of managed.rawCallbacks) {
          cb(filtered, id);
        }
      }

      // Parse and broadcast structured events
      const events = adapter.parseOutput(data);
      for (const event of events) {
        managed.eventHistory.push(event);
        if (managed.eventHistory.length > MAX_EVENT_HISTORY) {
          managed.eventHistory = managed.eventHistory.slice(-EVENT_TRIM_TO);
        }
        this.sessionStore.appendEvent(id, event);

        // Track tool use in state
        if (event.type === 'tool_use' && managed.state.status === 'running') {
          managed.state = {
            ...managed.state,
            toolCount: managed.state.toolCount + 1,
          };
        }

        if (event.type === 'tool_use') {
          this.pushTimeline(managed, 'tool_use', `Tool: ${event.tool}`);
        } else if (event.type === 'error') {
          this.pushTimeline(managed, 'error', event.message);
        }

        // For adapters that suppress raw output, forward text events to terminal
        if (filtered === null && event.type === 'raw_output') {
          managed.displayHistory.push(event.content);
          if (managed.displayHistory.length > MAX_OUTPUT_HISTORY) {
            managed.displayHistory = managed.displayHistory.slice(-OUTPUT_TRIM_TO);
          }
          this.sessionStore.appendOutput(id, event.content);
          for (const cb of managed.rawCallbacks) {
            cb(event.content, id);
          }
        }

        for (const cb of managed.eventCallbacks) {
          cb(event, id);
        }
      }
    });

    // PTY exit handler
    pty.onExit(({ exitCode }) => {
      managed.process.pid = undefined;
      managed.process.stoppedAt = new Date().toISOString();
      managed.eventCallbacks.clear();
      managed.rawCallbacks.clear();

      try {
        if (exitCode === 0) {
          this.transition(id, 'stopped', { exitCode });
        } else {
          this.transition(id, 'error', {
            error: `Process exited with code ${exitCode}`,
            code: exitCode,
          });
          // Then stop from error
          this.transition(id, 'stopped', { exitCode });
        }
      } catch {
        // If transition fails (already stopped), just update directly
        managed.state = { status: 'stopped', at: Date.now(), exitCode };
        managed.process.status = 'stopped';
        managed.process.stoppedAt = new Date().toISOString();
        this.sessionStore.patchSession(id, {
          status: 'stopped',
          stoppedAt: managed.process.stoppedAt,
          exitCode,
          updatedAt: managed.process.stoppedAt,
        });
      }

      this.evictStoppedBuffers();
      console.log(`Agent ${id} exited with code ${exitCode}`);
    });

    this.agents.set(id, managed);
    adapter.afterSpawn((data) => pty.write(data), config);
    this.notifyChanged();
    return id;
  }

  /** Start an agent backed by an SDK adapter (no PTY, no spawn). */
  async startSdk(config: AgentConfig, sdkAdapter: SdkAgentAdapter): Promise<string> {
    const id = generateSessionId();
    const cols = DEFAULT_COLS;
    const rows = DEFAULT_ROWS;

    const agentProcess: AgentProcess = {
      id,
      type: config.type,
      projectPath: config.projectPath,
      status: 'starting',
      startedAt: new Date().toISOString(),
      mode: 'sdk',
    };

    const managed: ManagedAgent = {
      process: agentProcess,
      adapter: null,
      pty: null,
      sdk: null,
      sdkAdapter,
      state: { status: 'initializing', at: Date.now() },
      cols,
      rows,
      outputHistory: [],
      displayHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: false,
    };

    this.agents.set(id, managed);

    this.sessionStore.upsertSession({
      id,
      type: config.type,
      projectPath: config.projectPath,
      mode: 'sdk',
      status: 'starting',
      createdAt: agentProcess.startedAt,
    });

    let write: (input: string) => void;
    let stop: () => Promise<void>;
    try {
      ({ write, stop } = await sdkAdapter.startSession(config, (event: ParsedEvent) => {
      managed.eventHistory.push(event);
      if (managed.eventHistory.length > MAX_EVENT_HISTORY) {
        managed.eventHistory = managed.eventHistory.slice(-EVENT_TRIM_TO);
      }
      this.sessionStore.appendEvent(id, event);

      if (managed.state.status === 'initializing') {
        this.transition(id, 'running');
      } else if (event.type === 'status_change') {
        // Mirror adapter-reported status into the daemon's canonical state so
        // /api/agents, agent_list and attach-time status_update tell the
        // truth. Without this every SDK session stayed 'running' forever.
        // Deliberately not transition(): the raw event is already recorded
        // and broadcast below — going through the state machine here would
        // duplicate it, and adapters may legitimately report sequences the
        // map rejects (events racing a stop()).
        this.syncSdkStatus(id, event.status);
      }

      if (event.type === 'tool_use' && managed.state.status === 'running') {
        managed.state = {
          ...managed.state,
          toolCount: managed.state.toolCount + 1,
        };
      }

      if (event.type === 'tool_use') {
        this.pushTimeline(managed, 'tool_use', `Tool: ${event.tool}`);
      } else if (event.type === 'error') {
        this.pushTimeline(managed, 'error', event.message);
      } else if (event.type === 'chat_message' || event.type === 'raw_output') {
        // Mirror assistant text into displayHistory so terminal reconnection
        // shows the conversation even for SDK-only agents.
        managed.displayHistory.push(event.content);
        if (managed.displayHistory.length > MAX_OUTPUT_HISTORY) {
          managed.displayHistory = managed.displayHistory.slice(-OUTPUT_TRIM_TO);
        }
        this.sessionStore.appendOutput(id, event.content);
        this.touch(id);
        for (const cb of managed.rawCallbacks) cb(event.content, id);
      }

      for (const cb of managed.eventCallbacks) cb(event, id);
      }));
    } catch (err) {
      // startSession threw (e.g. spawn failed / backend server never came
      // up): drop the just-registered agent so no zombie sits in the list in
      // 'initializing' forever, and surface a clear error.
      this.agents.delete(id);
      this.sessionStore.deleteSession(id);
      throw err instanceof Error ? err : new Error(String(err));
    }

    managed.sdk = { write, stop };

    if (managed.state.status === 'initializing') {
      this.transition(id, 'running');
    }
    this.notifyChanged();
    return id;
  }

  async stop(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') return;

    managed.eventCallbacks.clear();
    managed.rawCallbacks.clear();

    if (managed.sdk) {
      await managed.sdk.stop();
      // No PTY onExit will fire for SDK sessions — mark them stopped here or
      // they linger in the live list as unkillable "Running" rows.
      try {
        this.transition(id, 'stopped', { exitCode: 0 });
      } catch {
        managed.state = { status: 'stopped', at: Date.now(), exitCode: 0 };
        managed.process.status = 'stopped';
        managed.process.stoppedAt = new Date().toISOString();
        this.sessionStore.patchSession(id, {
          status: 'stopped',
          stoppedAt: managed.process.stoppedAt,
          exitCode: 0,
          updatedAt: managed.process.stoppedAt,
        });
      }
    }
    if (managed.pty) {
      managed.pty.kill();
    }

    if (!managed.pty && !managed.sdk) {
      managed.process.stoppedAt = new Date().toISOString();
      managed.state = { status: 'stopped', at: Date.now(), exitCode: 0 };
      managed.process.status = 'stopped';
      this.sessionStore.patchSession(id, {
        status: 'stopped',
        stoppedAt: managed.process.stoppedAt,
        exitCode: 0,
        updatedAt: managed.process.stoppedAt,
      });
    }

    this.evictStoppedBuffers();
    this.notifyChanged();
  }

  /**
   * Drop in-memory transcript buffers of long-dead sessions (the store has
   * them). Keeps the daemon's footprint flat instead of growing forever with
   * every stopped agent.
   */
  private evictStoppedBuffers(): void {
    const dead = Array.from(this.agents.values()).filter(
      (m) =>
        !m.historyOnly &&
        !m.offloaded &&
        (m.state.status === 'stopped' || m.state.status === 'error'),
    );
    if (dead.length <= KEEP_STOPPED_BUFFERED) return;
    dead.sort((a, b) => a.state.at - b.state.at);
    for (const m of dead.slice(0, dead.length - KEEP_STOPPED_BUFFERED)) {
      m.outputHistory = [];
      m.displayHistory = [];
      m.eventHistory = [];
      m.offloaded = true;
    }
  }

  // ── Query Methods ──────────────────────────────────────────────

  list(): AgentProcess[] {
    return Array.from(this.agents.values())
      .filter((m) => !m.historyOnly)
      .map((m) => m.process);
  }

  /**
   * Persistent session directory (live + past), paged, newest-activity first.
   * Live agents' current status/title win over the stored row.
   */
  listSessions(query: {
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
    archivedOnly?: boolean;
    projectPath?: string;
  } = {}): { sessions: SessionSummary[]; total: number; hasMore: boolean } {
    const result = this.sessionStore.list(query);
    for (const summary of result.sessions) {
      const managed = this.agents.get(summary.id);
      if (managed && !managed.historyOnly) {
        summary.status = managed.process.status;
        if (managed.process.title) summary.title = managed.process.title;
        if (managed.process.archivedAt) summary.archivedAt = managed.process.archivedAt;
      }
    }
    return result;
  }

  /** Lazy-load a dead session from the store when first referenced. */
  private ensureShell(id: string): ManagedAgent | null {
    const existing = this.agents.get(id);
    if (existing) return existing;
    const row = this.sessionStore.getSession(id);
    if (!row) return null;
    const shell: ManagedAgent = {
      process: {
        id: row.id,
        type: row.type as AgentProcess['type'],
        projectPath: row.project_path,
        status: row.status as AgentProcess['status'],
        startedAt: row.created_at,
        stoppedAt: row.stopped_at ?? undefined,
        mode: (row.mode as 'pty' | 'sdk' | null) ?? undefined,
        title: row.title ?? undefined,
        lastActivityAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined,
      },
      adapter: null,
      pty: null,
      sdk: null,
      sdkAdapter: null,
      state:
        row.status === 'stopped' || row.status === 'error'
          ? ({ status: row.status, at: Date.parse(row.updated_at), exitCode: 0 } as AgentState)
          : { status: 'stopped', at: Date.parse(row.updated_at), exitCode: -1 },
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      outputHistory: [],
      displayHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: true,
      historyOnly: true,
      offloaded: true,
    };
    this.agents.set(id, shell);
    return shell;
  }

  get(id: string): AgentProcess | undefined {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    return managed?.process;
  }

  getState(id: string): AgentState | undefined {
    return this.agents.get(id)?.state;
  }

  getSnapshot(id: string): AgentSnapshot | undefined {
    const managed = this.agents.get(id);
    if (!managed) return undefined;
    return {
      id: managed.process.id,
      type: managed.process.type,
      projectPath: managed.process.projectPath,
      state: managed.state,
      timeline: managed.timeline.slice(-MAX_TIMELINE),
      createdAt: managed.process.startedAt,
      pid: managed.process.pid,
      cols: managed.cols,
      rows: managed.rows,
    };
  }

  // ── Input / Control ────────────────────────────────────────────

  write(id: string, data: string): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') throw new Error(`Agent ${id} is stopped`);
    if (managed.pty) {
      const transformed = managed.adapter?.transformInput(data) ?? data;
      if (transformed !== null) {
        managed.pty.write(transformed);
      }
    } else if (managed.sdk) {
      managed.sdk.write(data);
    } else {
      throw new Error(`Agent ${id} has no active session`);
    }
  }

  /** Conversational write — appends newline for PTY agents, raw for SDK agents. */
  chatWrite(id: string, content: string): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') throw new Error(`Agent ${id} is stopped`);
    this.maybeTitle(id, content);

    if (managed.sdk) {
      managed.sdk.write(content);
    } else if (managed.pty) {
      const transformed = managed.adapter?.transformInput(content) ?? (content + '\n');
      managed.pty.write(transformed);
    } else {
      throw new Error(`Agent ${id} has no active session`);
    }
  }

  /** Mid-turn steering — injects a follow-up while the agent is still running. */
  steer(id: string, content: string): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') throw new Error(`Agent ${id} is stopped`);
    this.maybeTitle(id, content);

    if (managed.sdk) {
      managed.sdk.write(content);
    } else if (managed.pty) {
      // ESC to interrupt current prompt, then send the new content
      managed.pty.write('\x1b');
      setTimeout(() => {
        if (managed.pty) managed.pty.write(content + '\n');
      }, 200);
      const event: ParsedEvent = {
        type: 'chat_message',
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      managed.eventHistory.push(event);
      this.sessionStore.appendEvent(id, event);
      for (const cb of managed.eventCallbacks) {
        cb(event, id);
      }
    } else {
      throw new Error(`Agent ${id} has no active session`);
    }
  }

  /** Cancel the current in-progress turn (SDK stop or PTY Ctrl-C). */
  async cancelTurn(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') throw new Error(`Agent ${id} is stopped`);

    if (managed.sdk) {
      await managed.sdk.stop();
    } else if (managed.pty) {
      managed.pty.write('\x03');
    }
  }

  /** Allow external code to register an SDK session on an existing agent record. */
  registerSdk(id: string, sdk: SdkSession, adapter?: SdkAgentAdapter): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.sdk = sdk;
    if (adapter) managed.sdkAdapter = adapter;
  }

  /** Allow external code to register the SDK adapter (e.g. for approve/reject). */
  registerSdkAdapter(id: string, adapter: SdkAgentAdapter): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.sdkAdapter = adapter;
  }

  async approve(id: string, reason?: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed?.sdkAdapter?.approve) return;
    await managed.sdkAdapter.approve(reason);
  }

  async reject(id: string, reason?: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed?.sdkAdapter?.reject) return;
    await managed.sdkAdapter.reject(reason);
  }

  resize(id: string, cols: number, rows: number): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.cols = cols;
    managed.rows = rows;
    managed.pty?.resize(cols, rows);
  }

  // ── History ────────────────────────────────────────────────────

  /**
   * Full raw output history. For live agents this is ANSI-preserved PTY
   * output; offloaded/dead sessions fall back to the store's display chunks
   * (ANSI-stripped) — raw bytes were never persisted.
   */
  getOutputHistory(id: string): string[] {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.offloaded || managed.historyOnly) {
      return this.sessionStore.getOutputTail(id, OUTPUT_TRIM_TO);
    }
    return [...managed.outputHistory];
  }

  getDisplayHistory(id: string): string[] {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.offloaded || managed.historyOnly) {
      return this.sessionStore.getOutputTail(id, OUTPUT_TRIM_TO);
    }
    return [...managed.displayHistory];
  }

  /** Bounded display-output tail by byte budget — used for attach replay. */
  getDisplayHistoryTail(id: string, maxBytes = ATTACH_OUTPUT_BYTES): string[] {
    const chunks = this.getDisplayHistory(id);
    const tail: string[] = [];
    let size = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      size += chunks[i].length;
      tail.unshift(chunks[i]);
      if (size >= maxBytes) break;
    }
    return tail;
  }

  /** Bounded event tail (newest last) — used for attach replay. */
  getEventHistoryTail(id: string, limit = ATTACH_EVENT_TAIL): ParsedEvent[] {
    const events = this.getEventHistory(id);
    return events.length > limit ? events.slice(-limit) : events;
  }

  getEventHistory(id: string): ParsedEvent[] {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.offloaded || managed.historyOnly) {
      return this.sessionStore.getEventTail(id, EVENT_TRIM_TO);
    }
    return [...managed.eventHistory];
  }

  getTimeline(id: string): TimelineItem[] {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    return [...managed.timeline];
  }

  // ── Session management (archive / delete / rename) ──────────────

  async archive(id: string): Promise<void> {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.process.status !== 'stopped' && !managed.historyOnly) {
      await this.stop(id);
    }
    const at = new Date().toISOString();
    this.sessionStore.setArchived(id, at);
    this.sessionStore.patchSession(id, { updatedAt: at });
    managed.process.archivedAt = at;
    this.notifyChanged();
  }

  async unarchive(id: string): Promise<void> {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    this.sessionStore.setArchived(id, null);
    managed.process.archivedAt = undefined;
    this.notifyChanged();
  }

  /** Hard delete: stop if running, remove transcript + metadata everywhere. */
  async delete(id: string): Promise<void> {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.process.status !== 'stopped' && !managed.historyOnly) {
      await this.stop(id);
    }
    this.sessionStore.deleteSession(id);
    this.agents.delete(id);
    this.lastTouch.delete(id);
    this.notifyChanged();
  }

  setTitle(id: string, title: string): void {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    const trimmed = title.trim().slice(0, 120);
    managed.process.title = trimmed;
    this.sessionStore.patchSession(id, { title: trimmed });
    this.notifyChanged();
  }

  // ── Event Subscriptions ────────────────────────────────────────

  onEvent(id: string, callback: (event: ParsedEvent, sessionId: string) => void): () => void {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.eventCallbacks.add(callback);
    return () => managed.eventCallbacks.delete(callback);
  }

  onRaw(id: string, callback: (data: string, sessionId: string) => void): () => void {
    const managed = this.agents.get(id) ?? this.ensureShell(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.rawCallbacks.add(callback);
    return () => managed.rawCallbacks.delete(callback);
  }

  // ── Model Management ──────────────────────────────────────────────

  async listModels(id: string): Promise<string[]> {
    const adapter = this.getAdapterWithModels(id);
    if (!adapter) return [];
    const managed = this.agents.get(id);
    if (managed?.state?.status === 'stopped' || managed?.state?.status === 'error') return [];
    if ('listModels' in adapter && typeof adapter.listModels === 'function') {
      return Promise.resolve(adapter.listModels());
    }
    return [];
  }

  setModel(id: string, model: string): void {
    const adapter = this.getAdapterWithModels(id);
    if (adapter) adapter.selectedModel = model;
  }

  getSelectedModel(id: string): string | undefined {
    const adapter = this.getAdapterWithModels(id);
    return adapter?.selectedModel ?? undefined;
  }

  setReasoningEffort(id: string, effort: ReasoningEffort): void {
    const adapter = this.getAdapterWithModels(id);
    if (adapter && 'selectedReasoningEffort' in adapter) {
      (adapter as unknown as { selectedReasoningEffort: ReasoningEffort }).selectedReasoningEffort = effort;
    }
  }

  setThinkingConfig(id: string, config: ThinkingConfig): void {
    const adapter = this.getAdapterWithModels(id);
    if (adapter && 'setThinkingConfig' in adapter) {
      (adapter as unknown as { setThinkingConfig: (c: ThinkingConfig) => void }).setThinkingConfig(config);
    } else if (adapter && 'selectedReasoningEffort' in adapter) {
      // Fallback: map to legacy effort if adapter doesn't support ThinkingConfig
      const effort: ReasoningEffort =
        config.mode === 'level' && config.level === 'high'
          ? 'high'
          : config.mode === 'level' && config.level === 'low'
            ? 'low'
            : config.mode === 'level' && config.level === 'medium'
              ? 'medium'
              : config.mode === 'budget' && config.budget && config.budget > 1024
                ? 'high'
                : config.mode === 'budget' && config.budget && config.budget > 512
                  ? 'medium'
                  : config.mode === 'budget' && config.budget
                    ? 'low'
                    : 'medium';
      (adapter as unknown as { selectedReasoningEffort: ReasoningEffort }).selectedReasoningEffort = effort;
    }
  }

  setAccessMode(id: string, mode: AccessMode): void {
    const adapter = this.getAdapterWithModels(id);
    if (adapter && 'selectedAccessMode' in adapter) {
      (adapter as unknown as { selectedAccessMode: AccessMode }).selectedAccessMode = mode;
    }
  }

  setServiceTier(id: string, tier: ServiceTier): void {
    const adapter = this.getAdapterWithModels(id);
    if (adapter && 'selectedServiceTier' in adapter) {
      (adapter as unknown as { selectedServiceTier: ServiceTier }).selectedServiceTier = tier;
    }
  }

  // ── Git via SDK adapter (Codex/Claude SDK adapters expose git helpers) ──

  async listGitBranches(id: string): Promise<{ branches: string[]; currentBranch: string }> {
    const managed = this.agents.get(id);
    if (!managed?.sdkAdapter) return { branches: [], currentBranch: '' };
    const sa = managed.sdkAdapter as unknown as Record<string, unknown>;
    if ('listGitBranches' in sa && typeof sa.listGitBranches === 'function') {
      return (
        sa as unknown as { listGitBranches: () => Promise<{ branches: string[]; currentBranch: string }> }
      ).listGitBranches();
    }
    return { branches: [], currentBranch: '' };
  }

  async gitStatus(id: string): Promise<string> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitStatus() : '';
  }

  async gitDiff(id: string): Promise<string> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitDiff() : '';
  }

  async gitLog(id: string, count?: number): Promise<string> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitLog(count) : '';
  }

  async gitCheckout(id: string, branch: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitCheckout(branch) : { success: false, error: 'No adapter' };
  }

  async gitCommit(id: string, message: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitCommit(message) : { success: false, error: 'No adapter' };
  }

  async gitPush(id: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitPush() : { success: false, error: 'No adapter' };
  }

  async gitPull(id: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitPull() : { success: false, error: 'No adapter' };
  }

  async gitCreateBranch(id: string, name: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.gitCreateBranch(name) : { success: false, error: 'No adapter' };
  }

  getProjectPath(id: string): string {
    const adapter = this.getGitAdapter(id);
    return adapter ? adapter.getProjectPath() : '';
  }

  private getGitAdapter(id: string): {
    gitStatus: () => Promise<string>;
    gitDiff: () => Promise<string>;
    gitLog: (count?: number) => Promise<string>;
    gitCheckout: (branch: string) => Promise<{ success: boolean; error?: string }>;
    gitCommit: (message: string) => Promise<{ success: boolean; error?: string }>;
    gitPush: () => Promise<{ success: boolean; error?: string }>;
    gitPull: () => Promise<{ success: boolean; error?: string }>;
    gitCreateBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
    getProjectPath: () => string;
  } | null {
    const managed = this.agents.get(id);
    if (!managed?.sdkAdapter) return null;
    const sa = managed.sdkAdapter as unknown as Record<string, unknown>;
    if ('gitStatus' in sa && typeof sa.gitStatus === 'function') {
      return sa as unknown as {
        gitStatus: () => Promise<string>;
        gitDiff: () => Promise<string>;
        gitLog: (count?: number) => Promise<string>;
        gitCheckout: (branch: string) => Promise<{ success: boolean; error?: string }>;
        gitCommit: (message: string) => Promise<{ success: boolean; error?: string }>;
        gitPush: () => Promise<{ success: boolean; error?: string }>;
        gitPull: () => Promise<{ success: boolean; error?: string }>;
        gitCreateBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
        getProjectPath: () => string;
      };
    }
    return null;
  }

  private getAdapterWithModels(id: string): {
    selectedModel: string | null;
    listModels?: () => Promise<string[]> | string[];
  } | null {
    const managed = this.agents.get(id);
    if (!managed) return null;

    if (managed.sdkAdapter && typeof managed.sdkAdapter === 'object') {
      const sa = managed.sdkAdapter as unknown as Record<string, unknown>;
      if ('selectedModel' in sa) {
        return sa as unknown as { selectedModel: string | null; listModels?: () => Promise<string[]> | string[] };
      }
    }

    const adapter = managed.adapter as Record<string, unknown> | null;
    if (adapter && 'selectedModel' in adapter) {
      return adapter as unknown as { selectedModel: string | null; listModels?: () => Promise<string[]> | string[] };
    }
    return null;
  }
}
