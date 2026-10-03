import type { AgentAdapter, AgentConfig, AgentType, ParsedEvent, SpawnConfig } from '@baton/shared';

/**
 * Defensive git ref check for adapter git helpers that pass client-supplied
 * branch names as argv elements. Arg arrays eliminate shell injection, but a
 * leading '-'/'+' would still be parsed as a FLAG (e.g. branch '-B' →
 * `git checkout -B`). Reject anything that doesn't start alphanumeric.
 */
export function isSafeGitRef(ref: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9./-]*$/.test(ref);
}

/**
 * Build the provider-specific resume argv for `config.resume`. With a known
 * provider session id: `<idFlag> <id>`. Without: the provider's
 * "continue latest in this directory" flag.
 */
export function resumeArgs(
  spec: { idFlag?: string; latest?: string[] },
  resume?: { providerSessionId?: string },
): string[] {
  if (!resume) return [];
  if (resume.providerSessionId && spec.idFlag) {
    return [spec.idFlag, resume.providerSessionId];
  }
  return spec.latest ?? [];
}

/** Best-effort UUID extraction for provider session ids in TUI output. */
export function extractUuid(clean: string, label?: string): string | null {
  const pattern = label
    ? new RegExp(`${label}[^0-9a-f]{0,8}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`, 'i')
    : /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  return clean.match(pattern)?.[1] ?? null;
}

export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly name: string;
  abstract readonly agentType: AgentType;

  abstract detect(projectPath: string): boolean;
  abstract buildSpawnConfig(config: AgentConfig): SpawnConfig;
  abstract parseOutput(raw: string): ParsedEvent[];

  /** Optional: called after PTY spawn with the write function. Use for init handshakes. */
  afterSpawn(_write: (data: string) => void, _config: AgentConfig): void {}

  /** Optional: transform user terminal input before writing to PTY. Return null to suppress. */
  transformInput(data: string): string | null {
    return data;
  }

  /** Optional: filter raw PTY output before sending to terminal. Return null to suppress display. */
  filterRawOutput(data: string): string | null {
    return data;
  }

  /**
   * Optional: best-effort extraction of the provider-side conversation id
   * from cleaned (ANSI-stripped) output. The manager calls this on PTY data
   * until an id is found, and persists it so the session can be resumed
   * exactly (`--resume-id` / `--conversation` / `--session`) instead of via
   * the coarser "continue latest" fallback.
   */
  extractSessionId(_clean: string): string | null {
    return null;
  }
}
