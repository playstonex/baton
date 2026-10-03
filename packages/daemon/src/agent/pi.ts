import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter, resumeArgs, extractUuid } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

/**
 * Pi coding agent (`pi`, npm @mariozechner/pi-coding-agent) — minimalist
 * terminal coding agent with read/bash/edit/write tools. Interactive TUI by
 * default; provider/model flags flow through config.args (e.g. `--provider
 * anthropic --model claude-*`).
 */
export class PiAdapter extends BaseAgentAdapter {
  readonly name = 'Pi';
  readonly agentType = 'pi' as const;

  detect(_projectPath: string): boolean {
    try {
      execSync('which pi', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'pi',
      args: [
        // pi: `--session <path|id>` resumes a specific session, `-c` the previous.
        ...resumeArgs({ idFlag: '--session', latest: ['-c'] }, config.resume),
        ...(config.args ?? []),
      ],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  override extractSessionId(clean: string): string | null {
    return extractUuid(clean, 'session');
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();
    const clean = stripAnsi(raw);
    if (!clean) return events;

    if (/thinking|reasoning/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      return events;
    }

    // pi's tool calls render as `toolname(args…)` blocks (bash, edit, read, write)
    const toolMatch = clean.match(/^\s*›?\s*(bash|read|edit|write)\s*\((.{0,120})/i);
    if (toolMatch) {
      const tool = toolMatch[1].toLowerCase();
      events.push({
        type: 'tool_use',
        tool,
        args: { raw: toolMatch[2] },
        timestamp: now,
      });
      events.push({ type: 'status_change', status: 'executing', timestamp: now });
      return events;
    }

    const fileMatch = clean.match(
      /(?:read|writ|edit|creat|delet|updat)\w*\s+[\s`"']*([^\s`"']+\.\w+)/i,
    );
    if (fileMatch) {
      events.push({
        type: 'file_change',
        path: fileMatch[1],
        changeType: /creat/i.test(clean) ? 'create' : /delet/i.test(clean) ? 'delete' : 'modify',
        timestamp: now,
      });
      return events;
    }

    if (/error|failed:/i.test(clean)) {
      events.push({ type: 'error', message: clean, timestamp: now });
      return events;
    }

    events.push({ type: 'raw_output', content: raw, timestamp: now });
    return events;
  }
}
