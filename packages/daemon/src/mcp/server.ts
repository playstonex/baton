import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AgentManager } from '../agent/manager.js';
import type { BuiltTool, ToolContext } from '@flowwhips/shared';
import { agentTools } from './tools/agent-tools.js';
import { worktreeTools } from './tools/worktree.js';
import { providerTools } from './tools/provider.js';
import { McpClientManager } from './client.js';
import { loadMcpClientConfig } from './config.js';

let mcpClientManager: McpClientManager | null = null;

export function getMcpClientManager(): McpClientManager | null {
  return mcpClientManager;
}

function registerTool(server: McpServer, tool: BuiltTool, context: ToolContext): void {
  server.tool(tool.name, tool.description, tool.inputSchema, async (params) =>
    tool.execute(params as Record<string, unknown>, context),
  );
}

export function createMcpServer(agentManager: AgentManager): McpServer {
  const server = new McpServer({
    name: 'flowwhips-daemon',
    version: '0.1.0',
  });

  const context: ToolContext = { agentManager };

  const allTools = [...agentTools, ...worktreeTools, ...providerTools];
  for (const tool of allTools) {
    registerTool(server, tool, context);
  }

  return server;
}

async function connectExternalMcpServers(server: McpServer): Promise<void> {
  const config = await loadMcpClientConfig();
  if (Object.keys(config.servers).length === 0) return;

  mcpClientManager = new McpClientManager();
  await mcpClientManager.connectAll(config);

  for (const { serverName, tool } of mcpClientManager.getAllTools()) {
    const prefixedName = `mcp__${serverName}__${tool.name}`;
    server.tool(
      prefixedName,
      tool.description ?? `Tool from MCP server "${serverName}"`,
      async (extra) => {
        const result = await mcpClientManager!.callTool(
          serverName,
          tool.name,
          (extra as unknown as Record<string, unknown>) ?? {},
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      },
    );
  }
}

export async function startMcpServer(agentManager: AgentManager): Promise<void> {
  const server = createMcpServer(agentManager);
  await connectExternalMcpServers(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('FlowWhips MCP Server started (stdio transport)');
}
