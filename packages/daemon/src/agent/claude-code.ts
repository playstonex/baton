import type { AgentConfig, ParsedEvent, SpawnConfig } from '@flowwhips/shared';
import { BaseAgentAdapter } from './adapter.js';
import { ClaudeCodeParser } from '../parser/index.js';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly name = 'Claude Code';
  readonly agentType = 'claude-code' as const;
  private parser = new ClaudeCodeParser();

  detect(_projectPath: string): boolean {
    return true;
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'claude',
      args: config.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  parseOutput(raw: string): ParsedEvent[] {
    return this.parser.parse(raw);
  }

  resetParser(): void {
    this.parser.reset();
  }
}
