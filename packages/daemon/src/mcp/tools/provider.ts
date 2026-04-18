import { z } from 'zod';
import { buildTool, toolResult, toolError, type BuiltTool } from '@flowwhips/shared';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ProviderConfigSchema,
  EMPTY_PROVIDER_CONFIG,
  type ProviderConfig,
} from '@flowwhips/shared';

function getFlowwhipsHome(): string {
  return process.env.FLOWWHIPS_HOME ?? `${process.env.HOME ?? '~'}/.flowwhips`;
}

async function getProvidersPath(): Promise<string> {
  const home = getFlowwhipsHome();
  const dir = join(home);
  await mkdir(dir, { recursive: true });
  return join(dir, 'providers.json');
}

async function loadProviderConfig(): Promise<ProviderConfig> {
  try {
    const path = await getProvidersPath();
    const data = await readFile(path, 'utf-8');
    return ProviderConfigSchema.parse(JSON.parse(data));
  } catch {
    return EMPTY_PROVIDER_CONFIG;
  }
}

async function saveProviderConfig(config: ProviderConfig): Promise<void> {
  const path = await getProvidersPath();
  await writeFile(path, JSON.stringify(config, null, 2));
}

const providerList = buildTool({
  name: 'provider_list',
  description: 'List all configured providers',
  inputSchema: {},
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async () => {
    const config = await loadProviderConfig();
    const providers = Object.entries(config.providers).map(([name, profile]) => ({
      name,
      type: profile.type,
      models: profile.models ?? [],
      profiles: Object.keys(profile.profiles),
    }));
    return toolResult(JSON.stringify(providers));
  },
});

const providerModels = buildTool({
  name: 'provider_models',
  description: 'List available models for a provider',
  inputSchema: {
    provider: z.string().describe('Provider name'),
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async (params) => {
    const config = await loadProviderConfig();
    const profile = config.providers[params.provider as string];
    if (!profile) {
      return toolError(`Provider '${params.provider}' not found`);
    }
    return toolResult(
      JSON.stringify({
        provider: params.provider,
        models: profile.models ?? [],
        profiles: profile.profiles,
      }),
    );
  },
});

const providerAdd = buildTool({
  name: 'provider_add',
  description: 'Add or update a provider configuration',
  inputSchema: {
    name: z.string().describe('Provider name (e.g. "claude-opus", "qwen")'),
    type: z.enum(['claude-code', 'codex', 'opencode', 'custom']),
    binary: z.string().optional().describe('Path to custom binary (for custom type)'),
    models: z.array(z.string()).optional().describe('Available models'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params) => {
    const config = await loadProviderConfig();
    config.providers[params.name as string] = {
      type: params.type as 'claude-code' | 'codex' | 'opencode' | 'custom',
      ...(params.binary ? { binary: params.binary as string } : {}),
      ...(params.models ? { models: params.models as string[] } : {}),
      args: [],
      env: {},
      profiles: {},
    };
    await saveProviderConfig(config);
    return toolResult(JSON.stringify({ added: params.name }));
  },
});

export const providerTools: BuiltTool[] = [providerList, providerModels, providerAdd];
