import { z } from 'zod';

// Protocol version
export const PROTOCOL_VERSION = 1;

// Hello message: Client → Daemon (on connect)
export const HelloMessageSchema = z.object({
  type: z.literal('hello'),
  version: z.number().default(PROTOCOL_VERSION),
  channels: z.array(z.number()).default([0, 1, 2]), // which channels client supports
  sessionId: z.string().optional(), // for reconnection
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

// Create a hello message
export function createHello(options?: { sessionId?: string }): HelloMessage {
  return {
    type: 'hello',
    version: PROTOCOL_VERSION,
    channels: [0, 1, 2],
    ...options,
  };
}

// Create a welcome message
export function createWelcome(sessionId: string, agents: WelcomeMessage['agents']): WelcomeMessage {
  return {
    type: 'welcome',
    version: PROTOCOL_VERSION,
    sessionId,
    agents,
    serverTime: Date.now(),
  };
}
