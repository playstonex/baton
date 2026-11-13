import { create } from 'zustand';
import type { ParsedEvent } from '@baton/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, unknown>;
}

interface ChatState {
  messages: ChatMessage[];
  agentStatus: string;
  pendingApproval: boolean;
  approvalDetail: { toolName: string; detail: string } | null;
  addEvent: (event: ParsedEvent) => void;
  addUserMessage: (content: string) => void;
  setStatus: (status: string) => void;
  resolveApproval: () => void;
  clear: () => void;
}

let msgCounter = 0;

/** Cap on rendered chat messages — the store used to grow without bound for
 * the lifetime of a long agent session. */
const MAX_MESSAGES = 800;

const ANSI_ESCAPE =
  /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-_Z\\-_]|\r(?!\n)|\u0008/g;

function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function push(messages: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const combined = [...messages, ...next];
  return combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined;
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  agentStatus: 'unknown',
  pendingApproval: false,
  approvalDetail: null,

  addEvent: (event) =>
    set((state) => {
      const id = `msg-${++msgCounter}`;
      const ts = event.timestamp;

      if (event.type === 'status_change') {
        const nextPending = event.status === 'waiting_input';
        return {
          agentStatus: event.status,
          pendingApproval: nextPending ? state.pendingApproval : false,
          approvalDetail: nextPending ? state.approvalDetail : null,
        };
      }

      if (event.type === 'chat_message') {
        if (event.role === 'user') {
          const last = state.messages[state.messages.length - 1];
          if (last?.role === 'user' && last?.content === event.content) {
            return state;
          }
        }
        return {
          messages: push(state.messages, [
            {
              id,
              role: event.role,
              content: event.content,
              timestamp: ts,
              eventType: 'chat_message',
            },
          ]),
        };
      }

      if (event.type === 'raw_output') {
        const cleanContent = stripAnsiCodes(event.content);
        if (!cleanContent.trim()) return state;
        const messages = [...state.messages];
        const last = messages[messages.length - 1];
        if (last?.eventType === 'raw_output') {
          messages[messages.length - 1] = {
            ...last,
            content: last.content + cleanContent,
          };
        } else {
          messages.push({
            id: `msg-${++msgCounter}`,
            role: 'assistant',
            content: cleanContent,
            timestamp: ts,
            eventType: 'raw_output',
          });
        }
        return {
          messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
        };
      }

      if (event.type === 'waiting_approval' || event.type === 'permission_request') {
        const meta = (event as ParsedEvent & { meta?: Record<string, unknown> }).meta;
        const toolName =
          event.type === 'permission_request'
            ? event.tool || event.action || 'action'
            : ((meta?.toolName ?? 'action') as string);
        const detail =
          event.type === 'permission_request'
            ? event.description || ''
            : ((meta?.detail ?? '') as string);
        return {
          pendingApproval: true,
          approvalDetail: { toolName, detail },
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: `Approval required: ${toolName}${detail ? ` — ${detail}` : ''}`,
              timestamp: ts,
              eventType: 'waiting_approval',
            },
          ]),
        };
      }

      if (event.type === 'checkpoint_created') {
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: `Checkpoint captured: ${event.label} (${event.files.length} file${event.files.length !== 1 ? 's' : ''})`,
              timestamp: ts,
              eventType: 'checkpoint_created',
              meta: {
                checkpointId: event.checkpointId,
                files: event.files,
                headSha: event.headSha,
                label: event.label,
              },
            },
          ]),
        };
      }

      if (event.type === 'permission_response') {
        return {
          pendingApproval: false,
          approvalDetail: null,
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: event.approved ? 'Action approved' : 'Action rejected',
              timestamp: ts,
              eventType: 'permission_response',
            },
          ]),
        };
      }

      if (event.type === 'user_input_prompt') {
        const questions = event.questions ?? [];
        const content = questions
          .map((q) => `${q.header ? `[${q.header}] ` : ''}${q.question}`)
          .join('\n');
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'assistant' as const,
              content: content || 'Question from agent',
              timestamp: ts,
              eventType: 'user_input_prompt',
            },
          ]),
        };
      }

      if (event.type === 'tool_call_start') {
        const hint = event.description || event.title || '';
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: `${event.tool}${hint ? ` — ${hint}` : ''}`,
              timestamp: ts,
              eventType: 'tool_call_start',
              meta: event.args as Record<string, unknown>,
            },
          ]),
        };
      }

      if (event.type === 'plan') {
        const summary =
          event.explanation || event.steps?.map((s) => s.step).join('\n') || 'Plan updated';
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: summary,
              timestamp: ts,
              eventType: 'plan',
            },
          ]),
        };
      }

      if (event.type === 'diff') {
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: `Diff: ${event.path || 'changes'}`,
              timestamp: ts,
              eventType: 'diff',
            },
          ]),
        };
      }

      if (event.type === 'thinking') {
        const last = state.messages[state.messages.length - 1];
        if (last?.eventType === 'thinking') {
          return state;
        }
        return {
          messages: push(state.messages, [
            { id, role: 'system', content: 'Thinking...', timestamp: ts, eventType: 'thinking' },
          ]),
        };
      }

      if (event.type === 'tool_use') {
        const fileHint = event.args?.filePath ? ` → ${event.args.filePath}` : '';
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system',
              content: `${event.tool}${fileHint}`,
              timestamp: ts,
              eventType: 'tool_use',
              meta: event.args as Record<string, unknown>,
            },
          ]),
        };
      }

      if (event.type === 'file_change') {
        const icons: Record<string, string> = { create: '+', modify: '~', delete: '-' };
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system',
              content: `${icons[event.changeType] ?? '~'} ${event.changeType} ${event.path}`,
              timestamp: ts,
              eventType: 'file_change',
            },
          ]),
        };
      }

      if (event.type === 'command_exec') {
        return {
          messages: push(state.messages, [
            {
              id,
              role: 'system',
              content: `$ ${event.command}`,
              timestamp: ts,
              eventType: 'command_exec',
            },
          ]),
        };
      }

      if (event.type === 'error') {
        return {
          messages: push(state.messages, [
            { id, role: 'system', content: `${event.message}`, timestamp: ts, eventType: 'error' },
          ]),
        };
      }

      return state;
    }),

  addUserMessage: (content) =>
    set((state) => ({
      messages: push(state.messages, [
        {
          id: `msg-${++msgCounter}`,
          role: 'user',
          content,
          timestamp: Date.now(),
          eventType: 'chat_message',
        },
      ]),
    })),

  setStatus: (status) =>
    set((state) => ({
      agentStatus: status,
      pendingApproval: status === 'waiting_input' ? state.pendingApproval : false,
      approvalDetail: status === 'waiting_input' ? state.approvalDetail : null,
    })),

  resolveApproval: () => set({ pendingApproval: false, approvalDetail: null }),

  clear: () =>
    set({ messages: [], agentStatus: 'unknown', pendingApproval: false, approvalDetail: null }),
}));
