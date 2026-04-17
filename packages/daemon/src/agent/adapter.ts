import type { AgentAdapter, AgentConfig, AgentType, ParsedEvent, SpawnConfig } from '@flowwhips/shared';

export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly name: string;
  abstract readonly agentType: AgentType;

  abstract detect(projectPath: string): boolean;
  abstract buildSpawnConfig(config: AgentConfig): SpawnConfig;
  abstract parseOutput(raw: string): ParsedEvent[];
}
