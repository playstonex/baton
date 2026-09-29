#!/usr/bin/env node
/**
 * Minimal ACP agent stub for tests and live smoke runs.
 * Speaks JSON-RPC 2.0 over stdio:
 *   initialize      → result { agentInfo }
 *   session/new     → result { sessionId }
 *   session/prompt  → emits AgentMessageChunk(s) echoing the prompt,
 *                     (optionally a request_permission round-trip), TurnEnd
 * Non-JSON input on stderr-ish lines is ignored; unknown methods get errors.
 */
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (typeof id !== 'number' || typeof method !== 'string') return;

  switch (method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id, result: { agentInfo: { name: 'stub-agent', version: '0.1.0' } } });
      break;
    case 'session/new':
      send({ jsonrpc: '2.0', id, result: { sessionId: 'stub-session-1' } });
      break;
    case 'session/prompt': {
      const text = Array.isArray(params?.content)
        ? String(params.content[0]?.text ?? '')
        : '';
      if (text.startsWith('/ask-permission')) {
        send({
          jsonrpc: '2.0',
          id: 1000,
          method: 'session/request_permission',
          params: { tool: 'bash', action: 'run', description: 'stub asks permission' },
        });
      }
      const reply = `echo: ${text}`;
      send({
        jsonrpc: '2.0',
        method: 'session/notification',
        params: { sessionId: params?.sessionId, update: { type: 'AgentMessageChunk', content: reply } },
      });
      send({
        jsonrpc: '2.0',
        method: 'session/notification',
        params: { sessionId: params?.sessionId, update: { type: 'ToolCall', name: 'read_file', parameters: { path: '/tmp/x' }, status: 'running' } },
      });
      send({
        jsonrpc: '2.0',
        method: 'session/notification',
        params: { sessionId: params?.sessionId, update: { type: 'TurnEnd' } },
      });
      // Only answer the prompt request itself (id != 1000 permission id).
      if (id !== 1000) send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      break;
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
  }
});
