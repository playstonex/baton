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

export const ApiProviderProfileSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string(),
  models: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  createdAt: z.string().optional(),
});

export type ApiProviderProfile = z.infer<typeof ApiProviderProfileSchema>;

export const ApiProviderConfigSchema = z.object({
  providers: z.record(z.string(), ApiProviderProfileSchema),
});

export type ApiProviderConfig = z.infer<typeof ApiProviderConfigSchema>;

export const EMPTY_API_PROVIDER_CONFIG: ApiProviderConfig = { providers: {} };
