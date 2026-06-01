import { z } from 'zod';

// Protocol version
// COMPAT(protocol-v2): added in v2. Bump when adding capability flags.
export const PROTOCOL_VERSION = 2;

// Capability flags — daemon advertises, client checks before using features.
// Each flag names a feature gated by capability detection. When the floor version
// is high enough, remove the gate and the flag.
export interface ServerCapabilities {
  /** Git RPC (status, commit, push, pull, branches, checkout, log, stash) */
  gitRpc?: boolean; // COMPAT(gitRpc): added in v2, drop gate when floor >= v2
  /** Access control mode negotiation (on-request / full-access) */
  accessControl?: boolean; // COMPAT(accessControl): added in v2
  /** Push notification registration and delivery */
  pushNotifications?: boolean; // COMPAT(pushNotifications): added in v2
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
export const DEFAULT_CLIENT_CAPABILITIES = {
  gitRpc: true,
  accessControl: true,
  pushNotifications: true,
};

// Default daemon feature flags for current protocol version
export const DEFAULT_SERVER_FEATURES: ServerCapabilities = {
  gitRpc: true,
  accessControl: true,
  pushNotifications: true,
};

// Create a hello message
export function createHello(options?: { sessionId?: string; capabilities?: Record<string, boolean> }): HelloMessage {
  return {
    type: 'hello',
    version: PROTOCOL_VERSION,
    channels: [0, 1, 2],
    capabilities: { ...DEFAULT_CLIENT_CAPABILITIES, ...options?.capabilities },
    ...options,
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
