import type { AgentAdapter, AgentConfig, AgentType, ParsedEvent, SpawnConfig } from '@baton/shared';

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
