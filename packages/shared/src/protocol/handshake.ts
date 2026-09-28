import { z } from 'zod';

// Protocol version
// COMPAT(protocol-v2): added in v2. Bump when adding capability flags.
export const PROTOCOL_VERSION = 2;

// ── Server → Client feature flags ────────────────────────────────
// The daemon advertises these in `welcome.features`. A client checks them
// before USING a feature (gracefully degrade or prompt "update host").
// Protocol layer is always backward compatible (append-only); features
// may require a newer host and are explicitly gated.
export interface ServerCapabilities {
  /** Git RPC (status, commit, push, pull, branches, checkout, log, stash) */
  gitRpc?: boolean; // COMPAT(gitRpc): added in v2, drop gate when floor >= v2
  /** Access control mode negotiation (on-request / full-access) */
  accessControl?: boolean; // COMPAT(accessControl): added in v2
  /** Push notification registration and delivery */
  pushNotifications?: boolean; // COMPAT(pushNotifications): added in v2
  /** Session resume with sequence-based replay (resume_session control action) */
  sessionResume?: boolean; // COMPAT(sessionResume): added in v2.1
}

// ── Client → Server capability flags ─────────────────────────────
// The client advertises these in `hello.capabilities`. The daemon checks
// them before SENDING message variants a legacy client can't understand.
// Without this, sending a new message shape to an old client silently breaks it.
export interface ClientCapabilities {
  /** Client understands the `seq` field on streamed messages (resume support) */
  sessionResume?: boolean; // COMPAT(sessionResume): added in v2.1
  /** Client can render chat-style conversational messages (chat_input/steer/etc.) */
  chatMode?: boolean; // COMPAT(chatMode): added in v2
  /** Client can display structured tool-call events (tool_call_start/end) */
  structuredToolCalls?: boolean; // COMPAT(structuredToolCalls): added in v2
}

/**
 * Gate a feature on the peer's advertised capabilities. Returns true if the
 * peer advertised the capability (or if we have no peer info — fail open for
 * local development where handshakes are often skipped).
 *
 * Convention: when the protocol floor version is high enough that all clients
 * support a capability, delete the gate AND the capability flag in one commit.
 * Each gate is tagged `// COMPAT(<name>)` so `rg "COMPAT\("` shows the backlog.
 */
export function supports(
  peerCaps: Record<string, boolean> | undefined,
  flag: keyof ClientCapabilities | keyof ServerCapabilities,
): boolean {
  if (!peerCaps) return true; // fail open — no handshake yet
  return peerCaps[flag] === true;
}

// Hello message: Client → Daemon (on connect)
export const HelloMessageSchema = z.object({
  type: z.literal('hello'),
  version: z.number().default(PROTOCOL_VERSION),
  channels: z.array(z.number()).default([0, 1, 2]), // which channels client supports
  sessionId: z.string().optional(), // for reconnection
  capabilities: z.record(z.string(), z.boolean()).optional(), // client advertises supported capabilities
});

export type HelloMessage = z.infer<typeof HelloMessageSchema>;

// Welcome message: Daemon → Client (response to hello)
export const WelcomeMessageSchema = z.object({
  type: z.literal('welcome'),
  version: z.number(),
  sessionId: z.string(),
  agents: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      projectPath: z.string(),
    }),
  ),
  serverTime: z.number(),
  features: z.record(z.string(), z.boolean()).optional(), // COMPAT(features): daemon capability flags
});

export type WelcomeMessage = z.infer<typeof WelcomeMessageSchema>;

// Validate incoming hello
export function validateHello(data: unknown): HelloMessage {
  return HelloMessageSchema.parse(data);
}

// Validate incoming welcome
export function validateWelcome(data: unknown): WelcomeMessage {
  return WelcomeMessageSchema.parse(data);
}

// Default capability flags for current protocol version
export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  chatMode: true,
  structuredToolCalls: true,
  sessionResume: false, // COMPAT(sessionResume): opt-in until clients migrate
};

// Default daemon feature flags for current protocol version
export const DEFAULT_SERVER_FEATURES: ServerCapabilities = {
  gitRpc: true,
  accessControl: true,
  pushNotifications: true,
  sessionResume: false, // COMPAT(sessionResume): opt-in until clients migrate
};

// Create a hello message
export function createHello(options?: {
  sessionId?: string;
  capabilities?: Partial<ClientCapabilities>;
}): HelloMessage {
  const { sessionId, capabilities } = options ?? {};
  return {
    type: 'hello',
    version: PROTOCOL_VERSION,
    channels: [0, 1, 2],
    ...(sessionId !== undefined ? { sessionId } : {}),
    capabilities: { ...DEFAULT_CLIENT_CAPABILITIES, ...capabilities },
  };
}

// Create a welcome message
export function createWelcome(
  sessionId: string,
  agents: WelcomeMessage['agents'],
  features?: ServerCapabilities,
): WelcomeMessage {
  return {
    type: 'welcome',
    version: PROTOCOL_VERSION,
    sessionId,
    agents,
    serverTime: Date.now(),
    features: { ...DEFAULT_SERVER_FEATURES, ...features },
  };
}
