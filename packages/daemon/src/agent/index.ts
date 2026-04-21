export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
export { CodexAdapter } from './codex.js';
export { OpenCodeAdapter } from './opencode.js';
export { AgentManager } from './manager.js';
export { ProviderRegistry } from './registry.js';

import type { AgentType, AdapterMode } from '@flowwhips/shared';
import { ClaudeCodeAdapter } from './claude-code.js';
import { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
import type { BaseAgentAdapter } from './adapter.js';

const adapters: Record<string, new () => BaseAgentAdapter> = {
  'claude-code': ClaudeCodeAdapter,
  'claude-code-sdk': ClaudeSdkAdapter,
  codex: CodexAdapter,
  opencode: OpenCodeAdapter,
};

export function createAdapter(type: AgentType, mode: AdapterMode = 'pty'): BaseAgentAdapter {
  if (mode === 'sdk' || (mode === 'auto' && type === 'claude-code' && claudeSdkAdapter.isSdkAvailable())) {
    return claudeSdkAdapter;
  }
  const Adapter = adapters[type] ?? adapters['claude-code'];
  return new Adapter();
}

export function isSdkMode(type: AgentType): boolean {
  return type === 'claude-code-sdk';
}
