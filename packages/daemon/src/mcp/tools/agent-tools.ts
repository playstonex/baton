import { z } from 'zod';
import { buildTool, toolResult, toolError, type BuiltTool } from '@flowwhips/shared';
import type { AgentManager } from '../../agent/manager.js';
import type { BaseAgentAdapter } from '../../agent/adapter.js';
import { createAdapter } from '../../agent/index.js';

const agentCreate = buildTool({
  name: 'agent_create',
  description: 'Start a new coding agent',
  inputSchema: {
    provider: z.enum(['claude-code', 'codex', 'opencode']),
    projectPath: z.string().describe('Absolute path to the project directory'),
    prompt: z.string().optional().describe('Initial prompt to send to the agent'),
    worktree: z.boolean().default(false).describe('Create a git worktree for isolation'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params, ctx) => {
    const agentManager = ctx.agentManager as AgentManager;
    const adapter = createAdapter(params.provider as 'claude-code' | 'codex' | 'opencode');
    const sessionId = await agentManager.start(
      {
        type: params.provider as 'claude-code' | 'codex' | 'opencode',
        projectPath: params.projectPath as string,
      },
      adapter as BaseAgentAdapter,
    );

    if (params.prompt) {
      agentManager.write(sessionId, (params.prompt as string) + '\n');
    }

    return toolResult(JSON.stringify({ sessionId, status: 'running', provider: params.provider }));
  },
});

const agentList = buildTool({
  name: 'agent_list',
  description: 'List all running agents',
  inputSchema: {},
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async (_params, ctx) => {
    const agentManager = ctx.agentManager as AgentManager;
    const agents = agentManager.list();
    return toolResult(
      JSON.stringify(
        agents.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          projectPath: a.projectPath,
          pid: a.pid,
          startedAt: a.startedAt,
        })),
      ),
    );
  },
});

const agentStop = buildTool({
  name: 'agent_stop',
  description: 'Stop a running agent',
  inputSchema: {
    sessionId: z.string().describe('The agent session ID to stop'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params, ctx) => {
    const agentManager = ctx.agentManager as AgentManager;
    await agentManager.stop(params.sessionId as string);
    return toolResult(`Agent ${params.sessionId} stopped`);
  },
});

const agentSend = buildTool({
  name: 'agent_send',
  description: 'Send a message to an agent',
  inputSchema: {
    sessionId: z.string().describe('The agent session ID'),
    message: z.string().describe('The message to send'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params, ctx) => {
    const agentManager = ctx.agentManager as AgentManager;
    agentManager.write(params.sessionId as string, (params.message as string) + '\n');
    return toolResult('Message sent');
  },
});

const agentInspect = buildTool({
  name: 'agent_inspect',
  description: 'Get detailed information about an agent',
  inputSchema: {
    sessionId: z.string().describe('The agent session ID'),
  },
  isReadOnly: true,
  isConcurrencySafe: false,
  execute: async (params, ctx) => {
    const agentManager = ctx.agentManager as AgentManager;
    const snapshot = agentManager.getSnapshot(params.sessionId as string);
    if (!snapshot) {
      return toolError('Agent not found');
    }
    return toolResult(JSON.stringify(snapshot, null, 2));
  },
});

export const agentTools: BuiltTool[] = [agentCreate, agentList, agentStop, agentSend, agentInspect];
