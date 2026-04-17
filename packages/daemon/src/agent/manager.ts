import type { AgentConfig, AgentProcess, ParsedEvent } from '@flowwhips/shared';
import { generateId } from '@flowwhips/shared';
import type { BaseAgentAdapter } from './adapter.js';

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
  adapter: BaseAgentAdapter;
  pty: IPty;
  cols: number;
  rows: number;
  outputHistory: string[];
  eventHistory: ParsedEvent[];
  eventCallbacks: Set<(event: ParsedEvent, sessionId: string) => void>;
  rawCallbacks: Set<(data: string, sessionId: string) => void>;
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  async start(config: AgentConfig, adapter: BaseAgentAdapter): Promise<string> {
    const id = generateId();
    const spawnConfig = adapter.buildSpawnConfig(config);

    const { spawn } = await import('node-pty');
    const cols = 140;
    const rows = 40;

    const pty = spawn(spawnConfig.command, spawnConfig.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spawnConfig.cwd,
      env: spawnConfig.env as Record<string, string>,
    }) as unknown as IPty;

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
      cols,
      rows,
      outputHistory: [],
      eventHistory: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
    };

    pty.onData((data: string) => {
      // Store raw output for reconnection replay
      managed.outputHistory.push(data);
      if (managed.outputHistory.length > 10000) {
        managed.outputHistory = managed.outputHistory.slice(-5000);
      }

      // Broadcast raw terminal data
      for (const cb of managed.rawCallbacks) {
        cb(data, id);
      }

      // Parse and broadcast structured events
      const events = adapter.parseOutput(data);
      for (const event of events) {
        managed.eventHistory.push(event);
        if (managed.eventHistory.length > 5000) {
          managed.eventHistory = managed.eventHistory.slice(-2000);
        }
        for (const cb of managed.eventCallbacks) {
          cb(event, id);
        }
      }
    });

    pty.onExit(({ exitCode }) => {
      managed.process.status = 'stopped';
      managed.process.stoppedAt = new Date().toISOString();
      managed.process.pid = undefined;

      // Emit status change event
      const stopEvent: ParsedEvent = {
        type: 'status_change',
        status: 'stopped',
        timestamp: Date.now(),
      };
      managed.eventHistory.push(stopEvent);
      for (const cb of managed.eventCallbacks) {
        cb(stopEvent, id);
      }

      console.log(`Agent ${id} exited with code ${exitCode}`);
    });

    // Mark as running after a short delay (give pty time to initialize)
    setTimeout(() => {
      if (managed.process.status === 'starting') {
        managed.process.status = 'running';
        const runEvent: ParsedEvent = {
          type: 'status_change',
          status: 'running',
          timestamp: Date.now(),
        };
        managed.eventHistory.push(runEvent);
        for (const cb of managed.eventCallbacks) {
          cb(runEvent, id);
        }
      }
    }, 500);

    this.agents.set(id, managed);
    return id;
  }

  async stop(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.process.status === 'stopped') return;

    managed.pty.kill();
    managed.process.status = 'stopped';
    managed.process.stoppedAt = new Date().toISOString();
  }

  list(): AgentProcess[] {
    return Array.from(this.agents.values()).map((m) => m.process);
  }

  get(id: string): AgentProcess | undefined {
    return this.agents.get(id)?.process;
  }

  write(id: string, data: string): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    if (managed.process.status === 'stopped') throw new Error(`Agent ${id} is stopped`);
    managed.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Agent ${id} not found`);
    managed.cols = cols;
    managed.rows = rows;
    managed.pty.resize(cols, rows);
  }

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
