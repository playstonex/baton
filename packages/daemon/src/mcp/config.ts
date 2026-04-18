import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const McpServerConfigSchema = z.object({
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  url: z.string().optional(),
  enabled: z.boolean().default(true),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpClientConfigSchema = z.object({
  servers: z.record(z.string(), McpServerConfigSchema).default({}),
});

export type McpClientConfig = z.infer<typeof McpClientConfigSchema>;

export const EMPTY_MCP_CLIENT_CONFIG: McpClientConfig = { servers: {} };

function getFlowwhipsHome(): string {
  return process.env.FLOWWHIPS_HOME ?? `${process.env.HOME ?? '~'}/.flowwhips`;
}

async function getMcpServersPath(): Promise<string> {
  const home = getFlowwhipsHome();
  await mkdir(home, { recursive: true });
  return join(home, 'mcp-servers.json');
}

export async function loadMcpClientConfig(): Promise<McpClientConfig> {
  try {
    const path = await getMcpServersPath();
    const data = await readFile(path, 'utf-8');
    return McpClientConfigSchema.parse(JSON.parse(data));
  } catch {
    return EMPTY_MCP_CLIENT_CONFIG;
  }
}

export async function saveMcpClientConfig(config: McpClientConfig): Promise<void> {
  const path = await getMcpServersPath();
  await writeFile(path, JSON.stringify(config, null, 2));
}
