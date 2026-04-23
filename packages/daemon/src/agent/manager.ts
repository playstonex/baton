import type { AgentConfig, AgentProcess, ParsedEvent } from '@flowwhips/shared';
import { VALID_TRANSITIONS, generateId } from '@flowwhips/shared';
import type { AgentState, AgentSnapshot, TimelineItem } from '@flowwhips/shared';
import type { BaseAgentAdapter } from './adapter.js';
import { spawnPty } from '../pty/bridge.js';
import { mkdir, writeFile, readdir, stat, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

interface IPty {
  pid: number;
  kill(signal?: string): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

interface ManagedAgent {
  process: AgentProcess;
  adapter: BaseAgentAdapter | null;
  pty: IPty | null;
  state: AgentState;
  cols: number;
  rows: number;
  outputHistory: string[];
  eventHistory: ParsedEvent[];
  timeline: TimelineItem[];
  eventCallbacks: Set<(event: ParsedEvent, sessionId: string) => void>;
  rawCallbacks: Set<(data: string, sessionId: string) => void>;
  firstOutputReceived: boolean;
}

const MAX_OUTPUT_HISTORY = 10000;
const OUTPUT_TRIM_TO = 5000;
const MAX_EVENT_HISTORY = 5000;
const EVENT_TRIM_TO = 2000;
const MAX_TIMELINE = 200;
const DEFAULT_COLS = 140;
const DEFAULT_ROWS = 40;

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

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
    for (const cb of managed.eventCallbacks) cb(event, id);

    // Persist to disk (fire-and-forget)
    this.persist(id);
  }

  private pushTimeline(managed: ManagedAgent, type: string, summary: string): void {
    managed.timeline.push({ timestamp: Date.now(), type: type as TimelineItem['type'], summary });
    if (managed.timeline.length > MAX_TIMELINE) {
      managed.timeline = managed.timeline.slice(-MAX_TIMELINE);
    }
  }

  // ── Persistence ────────────────────────────────────────────────

  private get flowwhipsHome(): string {
    return process.env.FLOWWHIPS_HOME ?? `${process.env.HOME ?? '~'}/.flowwhips`;
  }

  private hashPath(projectPath: string): string {
    let hash = 0;
    for (let i = 0; i < projectPath.length; i++) {
      hash = (hash << 5) - hash + projectPath.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  private snapshotPath(id: string, projectPath: string): string {
    const hash = this.hashPath(projectPath);
    return join(this.flowwhipsHome, 'agents', hash, `${id}.json`);
  }

  private async persist(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed) return;

    const snapshot: AgentSnapshot = {
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

    try {
      const filePath = this.snapshotPath(id, managed.process.projectPath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(snapshot, null, 2));
    } catch (err) {
      console.error(`Failed to persist agent ${id}:`, err);
    }
  }

  async restore(): Promise<void> {
    const agentsDir = join(this.flowwhipsHome, 'agents');
    try {
      await access(agentsDir);
    } catch {
      return; // No agents dir yet
    }

    try {
      const dirs = await readdir(agentsDir);
      for (const dir of dirs) {
        const dirPath = join(agentsDir, dir);
        const s = await stat(dirPath);
        if (!s.isDirectory()) continue;

        const files = await readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const content = await readFile(join(dirPath, file), 'utf-8');
            const snapshot: AgentSnapshot = JSON.parse(content);

            // Crashed agents are always stopped after recovery
            if (snapshot.state.status !== 'stopped') {
              console.log(
                `Restoring agent ${snapshot.id} (was ${snapshot.state.status} → stopped)`,
              );
              snapshot.state = { status: 'stopped', at: Date.now(), exitCode: -1 };
            }

            const agentProcess: AgentProcess = {
              id: snapshot.id,
              type: snapshot.type,
              projectPath: snapshot.projectPath,
              status: 'stopped',
              startedAt: snapshot.createdAt,
              stoppedAt: new Date().toISOString(),
            };

            this.agents.set(snapshot.id, {
              process: agentProcess,
              adapter: null,
              pty: null,
              state: snapshot.state,
              cols: snapshot.cols ?? DEFAULT_COLS,
              rows: snapshot.rows ?? DEFAULT_ROWS,
              outputHistory: [],
              eventHistory: snapshot.timeline as unknown as ParsedEvent[],
              timeline: snapshot.timeline,
              eventCallbacks: new Set(),
              rawCallbacks: new Set(),
              firstOutputReceived: true,
            });
          } catch (err) {
            console.error(`Failed to restore ${file}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore agents:', err);
    }
  }

  // ── Agent Lifecycle ────────────────────────────────────────────

  async start(config: AgentConfig, adapter: BaseAgentAdapter): Promise<string> {
    const id = generateId();
    const spawnConfig = adapter.buildSpawnConfig(config);
    const cols = DEFAULT_COLS;
    const rows = DEFAULT_ROWS;

    const pty = await spawnPty(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env as Record<string, string>,
      cols,
      rows,
    });

    const agentProcess: AgentProcess = {
      id,
      type: config.type,
      projectPath: config.projectPath,
      status: 'starting',
      pid: pty.pid,
      startedAt: new Date().toISOString(),
    };

    const managed: ManagedAgent = {
      process: agentProcess,
      adapter,
      pty,
      state: { status: 'initializing', at: Date.now() },
      cols,
      rows,
      outputHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: false,
    };

    // PTY output handler
    pty.onData((data: string) => {
      // Store raw output for reconnection replay
      managed.outputHistory.push(data);
      if (managed.outputHistory.length > MAX_OUTPUT_HISTORY) {
        managed.outputHistory = managed.outputHistory.slice(-OUTPUT_TRIM_TO);
      }

      // Broadcast raw terminal data
      for (const cb of managed.rawCallbacks) {
        cb(data, id);
      }

      if (!managed.firstOutputReceived) {
        managed.firstOutputReceived = true;
        if (managed.state.status === 'initializing') {
          this.transition(id, 'running');
        }
      }

      // Parse and broadcast structured events
      const events = adapter.parseOutput(data);
      for (const event of events) {
        managed.eventHistory.push(event);
        if (managed.eventHistory.length > MAX_EVENT_HISTORY) {
          managed.eventHistory = managed.eventHistory.slice(-EVENT_TRIM_TO);
        }

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

        for (const cb of managed.eventCallbacks) {
          cb(event, id);
        }
      }
    });

    // PTY exit handler
    pty.onExit(({ exitCode }) => {
      managed.process.pid = undefined;
      managed.process.stoppedAt = new Date().toISOString();

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
      }

      console.log(`Agent ${id} exited with code ${exitCode}`);
    });

    this.agents.set(id, managed);
    this.persist(id);
    return id;
  }

  async stop(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.state.status === 'stopped') return;

    if (managed.pty) {
      managed.pty.kill();
    }

    // State transition will happen in onExit handler,
    // but force-stop if pty is null (restored agent)
    if (!managed.pty) {
      managed.process.stoppedAt = new Date().toISOString();
      managed.state = { status: 'stopped', at: Date.now(), exitCode: 0 };
      managed.process.status = 'stopped';
      this.persist(id);
    }
  }

  // ── Query Methods ──────────────────────────────────────────────

  list(): AgentProcess[] {
    return Array.from(this.agents.values()).map((m) => m.process);
  }

  get(id: string): AgentProcess | undefined {
    return this.agents.get(id)?.process;
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
    if (!managed.pty) throw new Error(`Agent ${id} has no PTY`);
    managed.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.cols = cols;
    managed.rows = rows;
    managed.pty?.resize(cols, rows);
  }

  // ── History ────────────────────────────────────────────────────

  getOutputHistory(id: string): string[] {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    return [...managed.outputHistory];
  }

  getEventHistory(id: string): ParsedEvent[] {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    return [...managed.eventHistory];
  }

  getTimeline(id: string): TimelineItem[] {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    return [...managed.timeline];
  }

  // ── Event Subscriptions ────────────────────────────────────────

  onEvent(id: string, callback: (event: ParsedEvent, sessionId: string) => void): () => void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.eventCallbacks.add(callback);
    return () => managed.eventCallbacks.delete(callback);
  }

  onRaw(id: string, callback: (data: string, sessionId: string) => void): () => void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.rawCallbacks.add(callback);
    return () => managed.rawCallbacks.delete(callback);
  }
}
