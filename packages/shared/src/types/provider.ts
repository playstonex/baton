import { z } from 'zod';

// Single provider profile (e.g., "claude-opus", "qwen")
export const ProviderProfileSchema = z.object({
  type: z.enum(['claude-code', 'codex', 'opencode', 'custom']),
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

// Root config file (~/.flowwhips/providers.json)
export const ProviderConfigSchema = z.object({
  providers: z.record(z.string(), ProviderProfileSchema),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Default empty config
export const EMPTY_PROVIDER_CONFIG: ProviderConfig = { providers: {} };
