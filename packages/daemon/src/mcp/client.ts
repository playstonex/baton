import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, McpClientConfig } from './config.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ConnectedServer {
  name: string;
  client: Client;
  tools: Tool[];
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export class McpClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  async connectAll(config: McpClientConfig): Promise<void> {
    const entries = Object.entries(config.servers).filter(([, cfg]) => cfg.enabled);

    const results = await Promise.allSettled(
      entries.map(async ([name, cfg]) => {
        try {
          await this.connect(name, cfg);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`Failed to connect to MCP server "${name}": ${errorMessage}`);
          this.servers.set(name, {
            name,
            client: undefined as unknown as Client,
            tools: [],
            status: 'error',
            error: errorMessage,
          });
        }
      }),
    );

    const connected = [...this.servers.values()].filter((s) => s.status === 'connected');
    const errored = [...this.servers.values()].filter((s) => s.status === 'error');
    console.error(
      `MCP clients: ${connected.length} connected, ${errored.length} failed out of ${results.length} configured`,
    );
  }

  async connect(name: string, config: McpServerConfig): Promise<ConnectedServer> {
    let transport;
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error(`MCP server "${name}": stdio transport requires a command`);
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...(process.env as Record<string, string>), ...config.env },
      });
    } else {
      if (!config.url) {
        throw new Error(`MCP server "${name}": http transport requires a URL`);
      }
      const { StreamableHTTPClientTransport } =
        await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      transport = new StreamableHTTPClientTransport(new URL(config.url));
    }

    const client = new Client({
      name: 'flowwhips-daemon',
      version: '0.1.0',
    });

    await client.connect(transport);

    const { tools } = await client.listTools();

    const connected: ConnectedServer = {
      name,
      client,
      tools,
      status: 'connected',
    };

    this.servers.set(name, connected);
    return connected;
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    if (server.status === 'connected') {
      try {
        await server.client.close();
      } catch {
        // close() may throw if the process already exited
      }
    }

    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  getAllTools(): Array<{ serverName: string; tool: Tool }> {
    const result: Array<{ serverName: string; tool: Tool }> = [];
    for (const server of this.servers.values()) {
      if (server.status !== 'connected') continue;
      for (const tool of server.tools) {
        result.push({ serverName: server.name, tool });
      }
    }
    return result;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" not found`);
    }
    if (server.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" is not connected (status: ${server.status})`);
    }

    return server.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  getStatus(): Array<{ name: string; status: string; toolCount: number }> {
    return [...this.servers.values()].map((server) => ({
      name: server.name,
      status: server.status,
      toolCount: server.tools.length,
    }));
  }
}
