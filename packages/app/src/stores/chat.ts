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
          messages: [...state.messages, { id, role: event.role, content: event.content, timestamp: ts, eventType: 'chat_message' }],
        };
      }

      if (event.type === 'raw_output') {
        if (!event.content?.trim()) return state;
        const messages = [...state.messages];
        const last = messages[messages.length - 1];
        if (last?.eventType === 'raw_output') {
          messages[messages.length - 1] = {
            ...last,
            content: last.content + event.content,
          };
        } else {
          messages.push({
            id: `msg-${++msgCounter}`,
            role: 'assistant',
            content: event.content,
            timestamp: ts,
            eventType: 'raw_output',
          });
        }
        return { messages };
      }

      if (event.type === 'waiting_approval') {
        const meta = (event as ParsedEvent & { meta?: Record<string, unknown> }).meta;
        const toolName = (meta?.toolName ?? 'unknown') as string;
        const detail = (meta?.detail ?? '') as string;
        return {
          pendingApproval: true,
          approvalDetail: { toolName, detail },
          messages: [...state.messages, {
            id,
            role: 'system' as const,
            content: `⏳ Approval required: ${toolName}${detail ? ` — ${detail}` : ''}`,
            timestamp: ts,
            eventType: 'waiting_approval',
          }],
        };
      }

      if (event.type === 'thinking') {
        const last = state.messages[state.messages.length - 1];
        if (last?.eventType === 'thinking') {
          return state;
        }
        return {
          messages: [...state.messages, { id, role: 'system', content: 'Thinking...', timestamp: ts, eventType: 'thinking' }],
        };
      }

      if (event.type === 'tool_use') {
        const fileHint = event.args?.filePath ? ` → ${event.args.filePath}` : '';
        return {
          messages: [...state.messages, { id, role: 'system', content: `🔧 ${event.tool}${fileHint}`, timestamp: ts, eventType: 'tool_use', meta: event.args as Record<string, unknown> }],
        };
      }

      if (event.type === 'file_change') {
        const icons: Record<string, string> = { create: '+', modify: '~', delete: '-' };
        return {
          messages: [...state.messages, { id, role: 'system', content: `${icons[event.changeType] ?? '~'} ${event.changeType} ${event.path}`, timestamp: ts, eventType: 'file_change' }],
        };
      }

      if (event.type === 'command_exec') {
        return {
          messages: [...state.messages, { id, role: 'system', content: `$ ${event.command}`, timestamp: ts, eventType: 'command_exec' }],
        };
      }

      if (event.type === 'error') {
        return {
          messages: [...state.messages, { id, role: 'system', content: `${event.message}`, timestamp: ts, eventType: 'error' }],
        };
      }

      return state;
    }),

  addUserMessage: (content) =>
    set((state) => ({
      messages: [...state.messages, { id: `msg-${++msgCounter}`, role: 'user', content, timestamp: Date.now(), eventType: 'chat_message' }],
    })),

  setStatus: (status) => set((state) => ({
    agentStatus: status,
    pendingApproval: status === 'waiting_input' ? state.pendingApproval : false,
    approvalDetail: status === 'waiting_input' ? state.approvalDetail : null,
  })),

  resolveApproval: () => set({ pendingApproval: false, approvalDetail: null }),

  clear: () => set({ messages: [], agentStatus: 'unknown', pendingApproval: false, approvalDetail: null }),
}));
