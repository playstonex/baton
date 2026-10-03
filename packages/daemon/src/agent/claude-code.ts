import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig, AgentType } from '@baton/shared';
import { BaseAgentAdapter, resumeArgs, extractUuid } from './adapter.js';
import { ClaudeCodeParser } from '../parser/index.js';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly name = 'Claude Code';
  readonly agentType: AgentType = 'claude-code';
  private parser = new ClaudeCodeParser();

  detect(_projectPath: string): boolean {
    return true;
  }

  isAvailable(): boolean {
    try {
      execSync('which claude', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'claude',
      args: [
        // claude: `--resume <id>` continues an exact session, `-c` the latest.
        ...resumeArgs({ idFlag: '--resume', latest: ['-c'] }, config.resume),
        ...(config.args ?? []),
      ],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
      cols: config.cols ?? 80,
      rows: config.rows ?? 24,
    };
  }

  override extractSessionId(clean: string): string | null {
    return extractUuid(clean, 'session');
  }

  parseOutput(raw: string): ParsedEvent[] {
    return this.parser.parse(raw);
  }

  resetParser(): void {
    this.parser.reset();
  }
}
