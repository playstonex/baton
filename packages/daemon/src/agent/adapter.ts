import type { AgentAdapter, AgentConfig, AgentType, ParsedEvent, SpawnConfig } from '@baton/shared';

/**
 * Defensive git ref check for adapter git helpers that pass client-supplied
 * branch names as argv elements. Arg arrays eliminate shell injection, but a
 * leading '-'/'+' would still be parsed as a FLAG (e.g. branch '-B' →
 * `git checkout -B`). Reject anything that doesn't start alphanumeric.
 */
export function isSafeGitRef(ref: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref);
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
}
