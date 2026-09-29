export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
export { CodexAdapter } from './codex.js';
export { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
export { KiroCliAdapter } from './kiro-cli.js';
export { KiroAcpAdapter, KiroAcpSdkAdapter, kiroAcpSdkAdapter } from './kiro-acp.js';
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
import { KiroAcpAdapter, kiroAcpSdkAdapter } from './kiro-acp.js';
import { OpenCodeAdapter } from './opencode.js';
import { opencodeSdkAdapter } from './opencode-sdk.js';
import type { BaseAgentAdapter } from './adapter.js';
import { adapterRegistry, type AdapterConstructor } from './adapter-registry.js';

// Built-in PTY providers live in the open registry so third-party plugins
// (plugins/loader.ts) register beside them instead of patching this file.
// Idempotent: if this module is ever evaluated twice in one process (bundler
// duplication, dual test runners), skip instead of throwing at import time —
// a duplicate identical registration is a no-op, not a conflict.
const builtinAdapters: Array<[string, AdapterConstructor]> = [
  ['claude-code', ClaudeCodeAdapter],
  ['claude-code-sdk', ClaudeSdkAdapter],
  ['codex', CodexAdapter],
  ['kiro-cli', KiroCliAdapter],
  ['kiro-cli-acp', KiroAcpAdapter],
  ['opencode', OpenCodeAdapter],
];
for (const [type, ctor] of builtinAdapters) {
  if (!adapterRegistry.has(type)) adapterRegistry.register(type, ctor);
}

const sdkAdapters: Partial<Record<AgentType, SdkAgentAdapter>> = {
  'claude-code-sdk': claudeSdkAdapter,
  'claude-code': claudeSdkAdapter,
  'codex-sdk': codexSdkAdapter,
  codex: codexSdkAdapter,
  opencode: opencodeSdkAdapter,
  'kiro-cli': kiroAcpSdkAdapter,
  'kiro-cli-acp': kiroAcpSdkAdapter,
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
    if ((type === 'kiro-cli' || type === 'kiro-cli-acp') && kiroAcpSdkAdapter.isSdkAvailable()) return kiroAcpSdkAdapter as unknown as BaseAgentAdapter;
  }
  // Registry first (covers built-ins + third-party plugins); fall back to the
  // default provider so a bad type never crashes a spawn request.
  return adapterRegistry.create(type) ?? new ClaudeCodeAdapter();
}

export function createSdkAdapter(type: AgentType): SdkAgentAdapter | null {
  return sdkAdapters[type] ?? null;
}

export function isSdkMode(type: AgentType): boolean {
  return (
    type === 'claude-code-sdk' ||
    type === 'claude-code' ||
    type === 'codex-sdk' ||
    type === 'codex' ||
    type === 'opencode' ||
    type === 'kiro-cli-acp' ||
    type === 'kiro-cli'
  );
}
