import type { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';

export interface ScheduleConfig {
  id: string;
  name: string;
  cron: string;
  agentType: string;
  projectPath: string;
  prompt: string;
  enabled: boolean;
}

export class ScheduleService {
  private schedules = new Map<string, ScheduleConfig>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  add(config: Omit<ScheduleConfig, 'id'>): ScheduleConfig {
    const schedule: ScheduleConfig = { ...config, id: crypto.randomUUID() };
    this.schedules.set(schedule.id, schedule);
    if (schedule.enabled) this.startTimer(schedule);
    return schedule;
  }

  remove(id: string): boolean {
    this.stopTimer(id);
    return this.schedules.delete(id);
  }

  list(): ScheduleConfig[] {
    return Array.from(this.schedules.values());
  }

  enable(id: string): void {
    const schedule = this.schedules.get(id);
    if (schedule) {
      schedule.enabled = true;
      this.startTimer(schedule);
    }
  }

  disable(id: string): void {
    const schedule = this.schedules.get(id);
    if (schedule) {
      schedule.enabled = false;
      this.stopTimer(id);
    }
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.stopTimer(id);
    }
  }

  private startTimer(schedule: ScheduleConfig): void {
    this.stopTimer(schedule.id);
    const intervalMs = this.parseCron(schedule.cron);
    const timer = setInterval(() => this.runSchedule(schedule), intervalMs);
    this.timers.set(schedule.id, timer);
  }

  private stopTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private async runSchedule(schedule: ScheduleConfig): Promise<void> {
    try {
      const adapter = createAdapter(schedule.agentType as 'claude-code' | 'codex' | 'opencode');
      const sessionId = await this.agentManager.start(
        {
          type: schedule.agentType as 'claude-code' | 'codex' | 'opencode',
          projectPath: schedule.projectPath,
        },
        adapter,
      );
      this.agentManager.write(sessionId, schedule.prompt + '\n');
    } catch (err) {
      console.error(`Schedule ${schedule.name} failed:`, err);
    }
  }

  private parseCron(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length === 1 && parts[0].endsWith('m')) {
      return parseInt(parts[0]) * 60 * 1000;
    }
    if (parts.length === 1 && parts[0].endsWith('h')) {
      return parseInt(parts[0]) * 60 * 60 * 1000;
    }
    return 60 * 60 * 1000; // default 1 hour
  }
}
