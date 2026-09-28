import { z } from 'zod';

// Single provider profile (e.g., "claude-opus", "qwen")
export const ProviderProfileSchema = z.object({
  type: z.enum(['claude-code', 'codex', 'opencode', 'kiro-cli', 'custom']),
  binary: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  models: z.array(z.string()).optional(),
  profiles: z
    .record(
      z.string(),
      z.object({
        model: z.string().optional(),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).default({}),
      }),
    )
    .default({}),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// Root config file (~/.baton/providers.json)
export const ProviderConfigSchema = z.object({
  providers: z.record(z.string(), ProviderProfileSchema),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Default empty config
export const EMPTY_PROVIDER_CONFIG: ProviderConfig = { providers: {} };

/**
 * How a provider's upstream endpoint is addressed. Maps 1:1 to Codex's
 * `wire_api` field under `[model_providers.<id>]`.
 * - `responses` (default): the base URL points at an OpenAI Responses API.
 * - `chat`: the base URL points at a standard OpenAI-compatible Chat
 *   Completions endpoint.
 */
export const ApiModeSchema = z
  .enum(['responses', 'chat', 'chat-completions'])
  // Legacy value normalization: older configs stored 'chat-completions'.
  .transform((v) => (v === 'chat-completions' ? ('chat' as const) : v));

export type ApiMode = z.infer<typeof ApiModeSchema>;

/**
 * Raw (pre-transform) API mode — includes the legacy `chat-completions` value
 * that gets normalized to `chat` during parsing.
 */
export type ApiModeRaw = 'responses' | 'chat' | 'chat-completions';

/**
 * The wire protocol spoken by a provider's upstream endpoint. The daemon
 * proxy adapts Codex's Responses-API request into this format before
 * forwarding, and converts the reply back into Responses format.
 * - `responses`: upstream speaks the OpenAI Responses API → passthrough.
 * - `openai-chat`: upstream speaks OpenAI Chat Completions → daemon converts
 *   Responses ↔ Chat Completions.
 * - `anthropic`: upstream speaks the Anthropic Messages API → daemon converts
 *   Responses ↔ Anthropic Messages.
 */
export const UpstreamFormatSchema = z.enum(['responses', 'openai-chat', 'anthropic']);

export type UpstreamFormat = z.infer<typeof UpstreamFormatSchema>;

export const ApiProviderProfileSchema = z.object({
  baseUrl: z.string().url(),
  /**
   * Name of the environment variable that holds the API key (NOT the key
   * itself). Mirrors Codex's `env_key`. Defaults to `OPENAI_API_KEY`.
   */
  envKey: z.string().default('OPENAI_API_KEY'),
  models: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  apiMode: ApiModeSchema.default('responses'),
  /** Wire protocol of the upstream endpoint; the proxy adapts to this. */
  upstreamFormat: UpstreamFormatSchema.default('responses'),
  createdAt: z.string().optional(),
});

export type ApiProviderProfile = z.infer<typeof ApiProviderProfileSchema>;

export const ApiProviderConfigSchema = z.object({
  providers: z.record(z.string(), ApiProviderProfileSchema),
});

export type ApiProviderConfig = z.infer<typeof ApiProviderConfigSchema>;

export const EMPTY_API_PROVIDER_CONFIG: ApiProviderConfig = { providers: {} };
