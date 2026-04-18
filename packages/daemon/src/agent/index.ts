export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { CodexAdapter } from './codex.js';
export { OpenCodeAdapter } from './opencode.js';
export { AgentManager } from './manager.js';
export { ProviderRegistry } from './registry.js';

import type { AgentType } from '@flowwhips/shared';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
import type { BaseAgentAdapter } from './adapter.js';

const adapters: Record<string, new () => BaseAgentAdapter> = {
  'claude-code': ClaudeCodeAdapter,
  codex: CodexAdapter,
  opencode: OpenCodeAdapter,
};

export function createAdapter(type: AgentType): BaseAgentAdapter {
  const Adapter = adapters[type] ?? adapters['claude-code'];
  return new Adapter();
}
