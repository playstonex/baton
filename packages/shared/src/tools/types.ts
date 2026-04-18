import type { z } from 'zod';

/** Index signature required for MCP SDK CallToolResult compatibility */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

/** Permission check result */
export interface PermissionResult {
  behavior: 'allow' | 'deny';
  reason?: string;
}

/** Context passed to tool execution */
export interface ToolContext {
  agentManager?: unknown;
  [key: string]: unknown;
}

/** Core tool definition — what every tool must provide */
export interface ToolDefinition<Input extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique tool name (e.g. 'agent_create') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for input validation */
  inputSchema: Record<string, z.ZodType>;
  /** Whether this tool only reads data (safe to parallelize) */
  isReadOnly?: boolean;
  /** Whether this tool can run concurrently with other tools */
  isConcurrencySafe?: boolean;
  /** Execute the tool */
  execute: (input: Input, context: ToolContext) => Promise<ToolResult>;
}

/** A complete tool with all defaults filled in */
export type BuiltTool<Input extends Record<string, unknown> = Record<string, unknown>> = Required<
  Pick<ToolDefinition<Input>, 'isReadOnly' | 'isConcurrencySafe'>
> &
  ToolDefinition<Input>;

/** Helper to create a success result */
export function toolResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Helper to create an error result */
export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
}
