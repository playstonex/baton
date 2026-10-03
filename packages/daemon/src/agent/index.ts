export { BaseAgentAdapter } from './adapter.js';
export { ClaudeCodeAdapter } from './claude-code.js';
export { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
export { CodexAdapter } from './codex.js';
export { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
export { KiroAdapter } from './kiro.js';
export { AntigravityAdapter } from './antigravity.js';
export { PiAdapter } from './pi.js';
export { OpenCodeAdapter } from './opencode.js';
export { OpenCodeSdkAdapter, opencodeSdkAdapter } from './opencode-sdk.js';
export { AgentManager } from './manager.js';
export { ProviderRegistry } from './registry.js';

import type { AgentType, AdapterMode, SdkAgentAdapter } from '@baton/shared';
import { ClaudeCodeAdapter } from './claude-code.js';
import { ClaudeSdkAdapter, claudeSdkAdapter } from './claude-sdk.js';
import { CodexAdapter } from './codex.js';
import { CodexSdkAdapter, codexSdkAdapter } from './codex-sdk.js';
import { KiroAdapter } from './kiro.js';
import { AntigravityAdapter } from './antigravity.js';
import { PiAdapter } from './pi.js';
import { OpenCodeAdapter } from './opencode.js';
import { OpenCodeSdkAdapter, opencodeSdkAdapter } from './opencode-sdk.js';
import type { BaseAgentAdapter } from './adapter.js';
import { adapterRegistry, type AdapterConstructor } from './adapter-registry.js';

// Built-in PTY providers live in the open registry so third-party plugins
// (plugins/loader.ts) register beside them instead of patching this file.
// Idempotent: if this module is ever evaluated twice in one process (bundler
// duplication, dual test runners), skip instead of throwing at import time —
// a duplicate identical registration is a no-op, not a conflict.
//
// 'kiro-cli' / 'kiro-cli-acp' are legacy aliases of 'kiro': the kiro-cli 2.x
// binary dropped its `acp` subcommand, so both old entries route to the one
// unified `kiro-cli chat` adapter (stable-protocol compatibility).
const builtinAdapters: Array<[string, AdapterConstructor]> = [
  ['claude-code', ClaudeCodeAdapter],
  ['claude-code-sdk', ClaudeSdkAdapter],
  ['codex', CodexAdapter],
  ['kiro', KiroAdapter],
  ['kiro-cli', KiroAdapter],
  ['kiro-cli-acp', KiroAdapter],
  ['antigravity', AntigravityAdapter],
  ['pi', PiAdapter],
  ['opencode', OpenCodeAdapter],
];
for (const [type, ctor] of builtinAdapters) {
  if (!adapterRegistry.has(type)) adapterRegistry.register(type, ctor);
}

// SDK (chat) adapters are constructed FRESH per session: every adapter
// carries per-session state (child process, sessionId, pending callbacks),
// so a shared singleton would make two concurrent same-type sessions clobber
// each other. The exported singletons below remain only as cheap
// availability probes for mode:'auto'. Kiro/Antigravity/Pi are PTY-only —
// their CLIs have no structured-IO mode we speak.
const sdkAdapterFactories: Partial<Record<AgentType, () => SdkAgentAdapter>> = {
  'claude-code-sdk': () => new ClaudeSdkAdapter(),
  'claude-code': () => new ClaudeSdkAdapter(),
  'codex-sdk': () => new CodexSdkAdapter(),
  codex: () => new CodexSdkAdapter(),
  opencode: () => new OpenCodeSdkAdapter(),
};

export function createAdapter(type: AgentType, mode: AdapterMode = 'pty'): BaseAgentAdapter {
  if (mode === 'sdk') {
    const sdk = createSdkAdapter(type);
    if (sdk) return sdk as unknown as BaseAgentAdapter;
  }
  if (mode === 'auto') {
    // Availability probes use the cheap long-lived singletons; the actual
    // adapter handed back is a fresh per-session instance.
    if (type === 'claude-code' && claudeSdkAdapter.isSdkAvailable()) return createSdkAdapter(type) as unknown as BaseAgentAdapter;
    if (type === 'codex' && codexSdkAdapter.isSdkAvailable()) return createSdkAdapter(type) as unknown as BaseAgentAdapter;
    if (type === 'opencode' && opencodeSdkAdapter.isSdkAvailable()) return createSdkAdapter(type) as unknown as BaseAgentAdapter;
  }
  // Registry first (covers built-ins + third-party plugins); fall back to the
  // default provider so a bad type never crashes a spawn request.
  return adapterRegistry.create(type) ?? new ClaudeCodeAdapter();
}

export function createSdkAdapter(type: AgentType): SdkAgentAdapter | null {
  const factory = sdkAdapterFactories[type];
  return factory ? factory() : null;
}

export function isSdkMode(type: AgentType): boolean {
  return (
    type === 'claude-code-sdk' ||
    type === 'claude-code' ||
    type === 'codex-sdk' ||
    type === 'codex' ||
    type === 'opencode' ||
    type === 'acp'
  );
}
