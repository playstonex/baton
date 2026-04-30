export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
export { CodexAdapter } from './codex.js';
export { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
export { OpenCodeAdapter } from './opencode.js';
export { OpenCodeSdkAdapter, opencodeSdkAdapter } from './opencode-sdk.js';
export { AgentManager } from './manager.js';
export { ProviderRegistry } from './registry.js';

import type { AgentType, AdapterMode } from '@baton/shared';
import { ClaudeCodeAdapter } from './claude-code.js';
import { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
import { CodexAdapter } from './codex.js';
import { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
import { OpenCodeAdapter } from './opencode.js';
import { opencodeSdkAdapter } from './opencode-sdk.js';
import type { BaseAgentAdapter } from './adapter.js';

const adapters: Record<string, new () => BaseAgentAdapter> = {
  'claude-code': ClaudeCodeAdapter,
  'claude-code-sdk': ClaudeSdkAdapter,
  codex: CodexAdapter,
  'codex-sdk': CodexSdkAdapter,
  opencode: OpenCodeAdapter,
};

const sdkAdapters: Record<string, BaseAgentAdapter> = {
  'claude-code-sdk': claudeSdkAdapter,
  'codex-sdk': codexSdkAdapter,
  codex: codexSdkAdapter,
  opencode: opencodeSdkAdapter,
};

const sdkTypes = new Set<string>(['claude-code-sdk', 'codex-sdk', 'codex', 'opencode']);

export function createAdapter(type: AgentType, mode: AdapterMode = 'pty'): BaseAgentAdapter {
  const useSdk = mode === 'sdk'
    || sdkTypes.has(type)
    || (mode === 'auto' && type === 'claude-code' && claudeSdkAdapter.isSdkAvailable());

  if (useSdk) {
    console.log(`[baton] createAdapter: SDK mode (type=${type}, mode=${mode})`);
    const sdk = sdkAdapters[type] ?? claudeSdkAdapter;
    return sdk;
  }
  const AdapterClass = adapters[type] ?? adapters['claude-code'];
  console.log(`[baton] createAdapter: ${mode} mode, type=${type} → ${AdapterClass.name}`);
  return new AdapterClass();
}

export function isSdkMode(type: AgentType): boolean {
  return sdkTypes.has(type);
}
