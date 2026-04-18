import type { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';

export interface LoopConfig {
  id: string;
  name: string;
  agentType: string;
  projectPath: string;
  initialPrompt: string;
  completionPattern: string;
  nextPrompt: string;
  maxIterations: number;
  currentIteration: number;
  running: boolean;
}

export class LoopService {
  private loops = new Map<string, LoopConfig>();
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  create(config: Omit<LoopConfig, 'id' | 'currentIteration' | 'running'>): LoopConfig {
    const loop: LoopConfig = {
      ...config,
      id: crypto.randomUUID(),
      currentIteration: 0,
      running: false,
    };
    this.loops.set(loop.id, loop);
    return loop;
  }

  async start(id: string): Promise<void> {
    const loop = this.loops.get(id);
    if (!loop || loop.running) return;

    loop.running = true;
    await this.runIteration(loop);
  }

  stop(id: string): void {
    const loop = this.loops.get(id);
    if (loop) loop.running = false;
  }

  list(): LoopConfig[] {
    return Array.from(this.loops.values());
  }

  private async runIteration(loop: LoopConfig): Promise<void> {
    while (loop.running && loop.currentIteration < loop.maxIterations) {
      loop.currentIteration++;

      try {
        const adapter = createAdapter(loop.agentType as 'claude-code' | 'codex' | 'opencode');
        const sessionId = await this.agentManager.start(
          {
            type: loop.agentType as 'claude-code' | 'codex' | 'opencode',
            projectPath: loop.projectPath,
          },
          adapter,
        );

        const prompt = loop.currentIteration === 1 ? loop.initialPrompt : loop.nextPrompt;
        this.agentManager.write(sessionId, prompt + '\n');

        await this.waitForCompletion(sessionId);
      } catch (err) {
        console.error(`Loop ${loop.name} iteration ${loop.currentIteration} failed:`, err);
      }

      if (loop.running && loop.currentIteration < loop.maxIterations) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    loop.running = false;
  }

  private waitForCompletion(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const agent = this.agentManager.get(sessionId);
        if (!agent || agent.status === 'stopped' || agent.status === 'error') {
          resolve();
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }
}
