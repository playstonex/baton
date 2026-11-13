import { execSync } from 'node:child_process';
import type { AgentConfig, ModelInfo, ParsedEvent, SpawnConfig, AgentType } from '@baton/shared';
import { BaseAgentAdapter, resumeArgs, extractUuid } from './adapter.js';
import { ClaudeCodeParser } from '../parser/index.js';
import { DEFAULT_CLAUDE_MODELS } from './claude-sdk.js';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly name = 'Claude Code';
  readonly agentType: AgentType = 'claude-code';
  selectedModel: string | null = null;
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

  listModels(): string[] {
    return DEFAULT_CLAUDE_MODELS.map((m) => m.id);
  }

  listModelDetails(): ModelInfo[] {
    return DEFAULT_CLAUDE_MODELS;
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    const permArgs: string[] = [];
    if (config.permissionMode === 'yolo' || config.permissionMode === 'bypassPermissions') {
      permArgs.push('--dangerously-skip-permissions');
    } else if (config.permissionMode === 'safe-yolo' || config.permissionMode === 'acceptEdits') {
      permArgs.push('--permission-mode', 'acceptEdits');
    } else if (config.permissionMode === 'read-only' || config.permissionMode === 'plan') {
      permArgs.push('--permission-mode', 'plan');
    } else if (config.permissionMode === 'default') {
      permArgs.push('--permission-mode', 'default');
    }

    return {
      command: 'claude',
      args: [
        // claude: `--resume <id>` continues an exact session, `-c` the latest.
        ...resumeArgs({ idFlag: '--resume', latest: ['-c'] }, config.resume),
        ...permArgs,
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
