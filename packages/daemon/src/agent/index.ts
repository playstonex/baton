export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
export { CodexAdapter } from './codex.js';
export { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
export { KiroCliAdapter } from './kiro-cli.js';
export { KiroAcpAdapter } from './kiro-acp.js';
export { OpenCodeAdapter } from './opencode.js';
export { OpenCodeSdkAdapter, opencodeSdkAdapter } from './opencode-sdk.js';
export { AgentManager } from './manager.js';
export { ProviderRegistry } from './registry.js';

import type { AgentType, AdapterMode, SdkAgentAdapter } from '@baton/shared';
import { ClaudeCodeAdapter } from './claude-code.js';
import { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
import { CodexAdapter } from './codex.js';
import { codexSdkAdapter } from './codex-sdk.js';
import { KiroCliAdapter } from './kiro-cli.js';
import { KiroAcpAdapter } from './kiro-acp.js';
import { OpenCodeAdapter } from './opencode.js';
import { opencodeSdkAdapter } from './opencode-sdk.js';
import type { BaseAgentAdapter } from './adapter.js';

const adapters: Record<string, new () => BaseAgentAdapter> = {
  'claude-code': ClaudeCodeAdapter,
  'claude-code-sdk': ClaudeSdkAdapter,
  codex: CodexAdapter,
  'kiro-cli': KiroCliAdapter,
  'kiro-cli-acp': KiroAcpAdapter,
  opencode: OpenCodeAdapter,
};

const sdkAdapters: Partial<Record<AgentType, SdkAgentAdapter>> = {
  'claude-code-sdk': claudeSdkAdapter,
  'codex-sdk': codexSdkAdapter,
  opencode: opencodeSdkAdapter,
};

export function createAdapter(type: AgentType, mode: AdapterMode = 'pty'): BaseAgentAdapter {
  if (mode === 'sdk') {
    const sdk = sdkAdapters[type];
    if (sdk) return sdk as unknown as BaseAgentAdapter;
  }
  if (mode === 'auto') {
    if (type === 'claude-code' && claudeSdkAdapter.isSdkAvailable()) return claudeSdkAdapter as unknown as BaseAgentAdapter;
    if (type === 'codex' && codexSdkAdapter.isSdkAvailable()) return codexSdkAdapter as unknown as BaseAgentAdapter;
    if (type === 'opencode' && opencodeSdkAdapter.isSdkAvailable()) return opencodeSdkAdapter as unknown as BaseAgentAdapter;
  }
  const Adapter = adapters[type] ?? adapters['claude-code'];
  return new Adapter();
}

export function createSdkAdapter(type: AgentType): SdkAgentAdapter | null {
  return sdkAdapters[type] ?? null;
}

export function isSdkMode(type: AgentType): boolean {
  return type === 'claude-code-sdk' || type === 'codex-sdk' || type === 'opencode';
}
