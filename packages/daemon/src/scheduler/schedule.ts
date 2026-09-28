import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';
import { nextFireDelayMs } from './cron.js';

export interface ScheduleConfig {
  id: string;
  name: string;
  /** Standard 5-field cron (minute hour dom month dow) or legacy Nm/Nh shorthand. */
  cron: string;
  agentType: string;
  projectPath: string;
  prompt: string;
  enabled: boolean;
}

function batonHome(): string {
  return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
}

function schedulesFile(): string {
  return join(batonHome(), 'schedules.json');
}

export class ScheduleService {
  private schedules = new Map<string, ScheduleConfig>();
  /** setTimeout handles (wall-clock, re-armed after each fire). */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /** Load persisted schedules and re-arm their timers. Call on daemon start. */
  async restore(): Promise<void> {
    const file = schedulesFile();
    if (!existsSync(file)) return;
    try {
      const raw = await readFile(file, 'utf-8');
      const arr = JSON.parse(raw) as ScheduleConfig[];
      for (const s of arr) {
        this.schedules.set(s.id, s);
        if (s.enabled) this.armTimer(s);
      }
      console.log(`[Scheduler] Restored ${arr.length} schedule(s)`);
    } catch (err) {
      console.error('[Scheduler] Failed to restore:', err);
    }
  }

  private persist(): void {
    const dir = batonHome();
    if (!existsSync(dir)) mkdir(dir, { recursive: true });
    const arr = Array.from(this.schedules.values());
    writeFile(schedulesFile(), JSON.stringify(arr, null, 2)).catch((err) =>
      console.error('[Scheduler] Failed to persist:', err),
    );
  }

  add(config: Omit<ScheduleConfig, 'id'>): ScheduleConfig {
    const schedule: ScheduleConfig = { ...config, id: crypto.randomUUID() };
    this.schedules.set(schedule.id, schedule);
    if (schedule.enabled) this.armTimer(schedule);
    this.persist();
    return schedule;
  }

  remove(id: string): boolean {
    this.disarmTimer(id);
    const removed = this.schedules.delete(id);
    if (removed) this.persist();
    return removed;
  }

  list(): ScheduleConfig[] {
    return Array.from(this.schedules.values());
  }

  enable(id: string): void {
    const schedule = this.schedules.get(id);
    if (schedule) {
      schedule.enabled = true;
      this.armTimer(schedule);
      this.persist();
    }
  }

  disable(id: string): void {
    const schedule = this.schedules.get(id);
    if (schedule) {
      schedule.enabled = false;
      this.disarmTimer(id);
      this.persist();
    }
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.disarmTimer(id);
    }
  }

  /**
   * Arm a wall-clock timer to fire at the next cron-matched moment. After
   * firing, re-arms for the subsequent match (this is what makes it true cron
   * rather than a fixed interval).
   */
  private armTimer(schedule: ScheduleConfig): void {
    this.disarmTimer(schedule.id);
    const delay = nextFireDelayMs(schedule.cron);
    const timer = setTimeout(() => {
      void this.runSchedule(schedule).finally(() => {
        // Re-arm for the next occurrence if still enabled.
        if (this.schedules.get(schedule.id)?.enabled) this.armTimer(schedule);
      });
    }, delay);
    timer.unref?.(); // don't keep the process alive solely for schedules
    this.timers.set(schedule.id, timer);
  }

  private disarmTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private async runSchedule(schedule: ScheduleConfig): Promise<void> {
    try {
      const adapter = createAdapter(
        schedule.agentType as 'claude-code' | 'codex' | 'opencode' | 'kiro-cli',
      );
      const sessionId = await this.agentManager.start(
        {
          type: schedule.agentType as 'claude-code' | 'codex' | 'opencode' | 'kiro-cli',
          projectPath: schedule.projectPath,
        },
        adapter,
      );
      this.agentManager.write(sessionId, schedule.prompt + '\n');
      console.log(`[Scheduler] "${schedule.name}" fired → session ${sessionId.slice(0, 8)}`);
    } catch (err) {
      console.error(`[Scheduler] "${schedule.name}" failed:`, err);
    }
  }
}
