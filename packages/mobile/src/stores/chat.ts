import { create } from 'zustand';
import type { ParsedEvent } from '@baton/shared';

export type MessageKind =
  | 'chat'
  | 'thinking'
  | 'toolActivity'
  | 'fileChange'
  | 'commandExecution'
  | 'subagentAction'
  | 'plan'
  | 'error';

export interface ChatMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  kind: MessageKind;
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, unknown>;
  isStreaming?: boolean;
  isCollapsed?: boolean;
  itemId?: string;
}

interface InternalState {
  _counter: number;
  _turnCounter: number;
  _streamBuffer: string;
  _streamTimer: ReturnType<typeof setTimeout> | null;
  _itemIdToMsgId: Map<string, string>;
  _streamingMsgIdByType: Map<string, string>;
}

interface ChatState extends InternalState {
  messages: ChatMessage[];
  agentStatus: string;
  waitingApproval: boolean;
  addEvent: (event: ParsedEvent) => void;
  addUserMessage: (content: string) => void;
  setStatus: (status: string) => void;
  setWaitingApproval: (waiting: boolean) => void;
  clear: () => void;
}

const STREAM_THROTTLE_MS = 80;

function isBareShellPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^\$?\s*(Exit\s+\d+)?$/.test(trimmed)) return true;
  if (/^[#$>]\s*$/.test(trimmed)) return true;
  return false;
}

function nextId(s: ChatState): string {
  const next = s._counter + 1;
  return `m-${next}`;
}

function currentTurnId(s: ChatState): string {
  return `t-${s._turnCounter}`;
}

function pruneDuplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const key = `${m.kind}:${m.content}:${m.itemId ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.unshift(m);
    }
  }
  return result;
}

function flushStream(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const current = get();
  if (!current._streamBuffer) return;
  const content = current._streamBuffer;
  const timer = current._streamTimer;
  if (timer) {
    clearTimeout(timer);
  }

  set((s) => {
    const msgs = [...s.messages];
    const streamingId = s._streamingMsgIdByType.get('raw_output');
    if (streamingId) {
      const idx = msgs.findIndex((m) => m.id === streamingId);
      if (idx >= 0 && msgs[idx].isStreaming) {
        msgs[idx] = { ...msgs[idx], content: msgs[idx].content + content };
        return { messages: msgs, _streamBuffer: '', _streamTimer: null };
      }
    }
    const id = nextId(s);
    const updatedStreaming = new Map(s._streamingMsgIdByType);
    updatedStreaming.set('raw_output', id);
    msgs.push({
      id,
      turnId: currentTurnId(s),
      role: 'assistant',
      kind: 'chat',
      content,
      timestamp: Date.now(),
      eventType: 'raw_output',
      isStreaming: true,
    });
    return {
      messages: msgs,
      _streamBuffer: '',
      _streamTimer: null,
      _streamingMsgIdByType: updatedStreaming,
      _counter: s._counter + 1,
    };
  });
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  agentStatus: 'unknown',
  waitingApproval: false,
  _counter: 0,
  _turnCounter: 0,
  _streamBuffer: '',
  _streamTimer: null,
  _itemIdToMsgId: new Map<string, string>(),
  _streamingMsgIdByType: new Map<string, string>(),

  addEvent: (event) => {
    if (__DEV__ && (event.type === 'chat_message' || event.type === 'status_change')) {
      const contentLen = 'content' in event ? (event as { content?: string }).content?.length ?? 0 : 0;
      console.log(`[chat] addEvent type=${event.type} role=${'role' in event ? (event as { role?: string }).role : ''} contentLen=${contentLen} status=${'status' in event ? (event as { status?: string }).status : ''}`);
    }
    if (event.type === 'raw_output') {
      if (!event.content?.trim()) return;

      if (event.itemId) {
        const existingMsgId = get()._itemIdToMsgId.get(event.itemId);
        if (existingMsgId) {
          set((s) => {
            const msgs = [...s.messages];
            const idx = msgs.findIndex((m) => m.id === existingMsgId);
            if (idx >= 0) {
              msgs[idx] = { ...msgs[idx], content: msgs[idx].content + event.content };
            }
            return { messages: msgs };
          });
          return;
        }
      }

      set((s) => ({
        _streamBuffer: s._streamBuffer + event.content,
        _streamTimer: s._streamTimer ?? setTimeout(() => flushStream(set, get), STREAM_THROTTLE_MS),
      }));
      return;
    }

    if (get()._streamBuffer) {
      flushStream(set, get);
    }

    set((state) => {
      const ts = event.timestamp;
      const tid = currentTurnId(state);
      const itemId = 'itemId' in event ? (event as { itemId?: string }).itemId : undefined;

      if (event.type === 'status_change') {
        if (event.status === 'idle' || event.status === 'stopped') {
          const msgs = pruneDuplicateMessages(
            state.messages.map((m) => {
              if (!m.isStreaming) return m;
              const meta = m.meta ? { ...m.meta, isStreaming: false } : m.meta;
              return { ...m, isStreaming: false, meta };
            }),
          );
          return {
            agentStatus: event.status,
            messages: msgs,
            _streamingMsgIdByType: new Map<string, string>(),
          };
        }
        return { agentStatus: event.status };
      }

      if (event.type === 'waiting_approval') {
        return { waitingApproval: true };
      }

      if (event.type === 'chat_message') {
        if (event.role === 'user') {
          const last = state.messages[state.messages.length - 1];
          if (last?.role === 'user' && last?.content === event.content) {
            return state;
          }
          const newTurn = state._turnCounter + 1;
          const newTid = `t-${newTurn}`;
          const newCounter = state._counter + 1;
          const id = `m-${newCounter}`;
          return {
            _turnCounter: newTurn,
            _counter: newCounter,
            messages: [
              ...state.messages,
              {
                id,
                turnId: newTid,
                role: event.role,
                kind: 'chat' as const,
                content: event.content,
                timestamp: ts,
                eventType: 'chat_message',
                itemId,
              },
            ],
          };
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        return {
          _counter: newCounter,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: event.role,
              kind: 'chat' as const,
              content: event.content,
              timestamp: ts,
              eventType: 'chat_message',
              itemId,
            },
          ],
        };
      }

      if (event.type === 'thinking') {
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          const existingId = state._itemIdToMsgId.get(itemId)!;
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === existingId);
          if (idx >= 0) {
            msgs[idx] = {
              ...msgs[idx],
              content: msgs[idx].content + event.content,
              isStreaming: true,
            };
            return { messages: msgs };
          }
        }
        const streamingId = state._streamingMsgIdByType.get('thinking');
        if (streamingId) {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === streamingId && m.isStreaming);
          if (idx >= 0) {
            msgs[idx] = { ...msgs[idx], content: msgs[idx].content + event.content };
            return { messages: msgs };
          }
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        const updatedStreaming = new Map(state._streamingMsgIdByType);
        updatedStreaming.set('thinking', id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          _streamingMsgIdByType: updatedStreaming,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'thinking' as const,
              content: event.content,
              timestamp: ts,
              eventType: 'thinking',
              isStreaming: true,
              itemId,
            },
          ],
        };
      }

      if (event.type === 'tool_use') {
        const hint = event.args?.filePath ? ` \u2192 ${event.args.filePath}` : '';
        const content = `${event.tool}${hint}`;
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          return state;
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'toolActivity' as const,
              content,
              timestamp: ts,
              eventType: 'tool_use',
              meta: event.args as Record<string, unknown>,
              itemId,
            },
          ],
        };
      }

      if (event.type === 'file_change') {
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          return state;
        }
        const icons: Record<string, string> = { create: '+', modify: '~', delete: '-' };
        const existingIdx = state.messages.findIndex(
          (m) => m.kind === 'fileChange' && m.meta?.path === event.path && m.eventType === 'file_change',
        );
        if (existingIdx >= 0) return state;
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'fileChange' as const,
              content: `${icons[event.changeType] ?? '~'} ${event.changeType} ${event.path}`,
              timestamp: ts,
              eventType: 'file_change',
              meta: { path: event.path, changeType: event.changeType },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'command_exec') {
        const command = event.command || '';
        const output = event.output ?? '';
        const messages = [...state.messages];

        if (!command && isBareShellPrompt(output)) return state;
        if (command && isBareShellPrompt(command) && !output) return state;

        if (itemId && state._itemIdToMsgId.has(itemId)) {
          const existingId = state._itemIdToMsgId.get(itemId)!;
          const idx = messages.findIndex((m) => m.id === existingId);
          if (idx >= 0) {
            const existing = messages[idx];
            const meta = { ...(existing.meta ?? {}) } as Record<string, unknown>;
            if (event.exitCode !== undefined) meta.exitCode = event.exitCode;
            if (output) meta.output = ((meta.output as string) ?? '') + output;
            if (command && !meta.command) meta.command = command;
            meta.isStreaming = event.isStreaming ?? true;
            const mergedCommand = (meta.command as string) ?? command ?? '';
            const mergedOutput = (meta.output as string) ?? '';
            messages[idx] = {
              ...existing,
              content: mergedCommand ? `$ ${mergedCommand}` : mergedOutput,
              meta,
              isStreaming: event.isStreaming ?? true,
            };
            return { messages };
          }
        }

        if (!command && !output) return state;

        const streamingId = state._streamingMsgIdByType.get('command_exec');
        if (streamingId && !itemId) {
          const idx = messages.findIndex((m) => m.id === streamingId && m.isStreaming);
          if (idx >= 0) {
            const existing = messages[idx];
            const meta = { ...(existing.meta ?? {}) } as Record<string, unknown>;
            if (event.exitCode !== undefined) meta.exitCode = event.exitCode;
            if (output) meta.output = ((meta.output as string) ?? '') + output;
            if (command && !meta.command) meta.command = command;
            meta.isStreaming = event.isStreaming ?? true;
            const mergedCommand = (meta.command as string) ?? command ?? '';
            const mergedOutput = (meta.output as string) ?? '';
            messages[idx] = {
              ...existing,
              content: mergedCommand ? `$ ${mergedCommand}` : mergedOutput,
              meta,
              isStreaming: event.isStreaming ?? true,
            };
            return { messages };
          }
        }

        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        const updatedStreaming = new Map(state._streamingMsgIdByType);
        updatedStreaming.set('command_exec', id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          _streamingMsgIdByType: updatedStreaming,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'commandExecution' as const,
              content: command ? `$ ${command}` : output,
              timestamp: ts,
              eventType: 'command_exec',
              meta: { command, output, exitCode: event.exitCode, isStreaming: event.isStreaming },
              isStreaming: event.isStreaming,
              itemId,
            },
          ],
        };
      }

      if (event.type === 'plan') {
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          const existingId = state._itemIdToMsgId.get(itemId)!;
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === existingId);
          if (idx >= 0) {
            msgs[idx] = {
              ...msgs[idx],
              content: event.explanation ?? msgs[idx].content,
              meta: { steps: event.steps, presentation: event.presentation },
            };
            return { messages: msgs };
          }
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'plan' as const,
              content: event.explanation ?? '',
              timestamp: ts,
              eventType: 'plan',
              meta: { steps: event.steps, presentation: event.presentation },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'diff') {
        const targetPath = event.path;
        if (targetPath) {
          const existingIdx = state.messages.findIndex(
            (m) => m.kind === 'fileChange' && m.meta?.path === targetPath,
          );
          if (existingIdx >= 0) {
            const messages = [...state.messages];
            const existing = messages[existingIdx];
            messages[existingIdx] = {
              ...existing,
              meta: { ...existing.meta, diff: event.diff },
            };
            return { messages };
          }
        }
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          return state;
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'fileChange' as const,
              content: event.path ? `diff ${event.path}` : 'diff',
              timestamp: ts,
              eventType: 'diff',
              meta: { diff: event.diff, path: event.path },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'user_input_prompt') {
        const questionText = event.questions.map((q) => q.question).join('\n');
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        return {
          _counter: newCounter,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'chat' as const,
              content: questionText,
              timestamp: ts,
              eventType: 'user_input_prompt',
              meta: { questions: event.questions },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'token_usage') {
        return state;
      }

      if (event.type === 'subagent') {
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          const existingId = state._itemIdToMsgId.get(itemId)!;
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === existingId);
          if (idx >= 0) {
            msgs[idx] = {
              ...msgs[idx],
              content: event.content ?? msgs[idx].content,
              meta: {
                ...(msgs[idx].meta ?? {}),
                action: event.action,
                name: event.name,
                model: event.model,
                status: event.status,
              },
            };
            return { messages: msgs };
          }
        }
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'subagentAction' as const,
              content: event.content ?? event.name ?? 'Subagent',
              timestamp: ts,
              eventType: 'subagent',
              meta: {
                action: event.action,
                name: event.name,
                model: event.model,
                status: event.status,
              },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'error') {
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        return {
          _counter: newCounter,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'error' as const,
              content: `${event.message}`,
              timestamp: ts,
              eventType: 'error',
            },
          ],
        };
      }

      return state;
    });
  },

  addUserMessage: (content) => {
    set((state) => {
      const newTurn = state._turnCounter + 1;
      const tid = `t-${newTurn}`;
      const newCounter = state._counter + 1;
      const id = `m-${newCounter}`;
      return {
        _turnCounter: newTurn,
        _counter: newCounter,
        messages: [
          ...state.messages,
          {
            id,
            turnId: tid,
            role: 'user' as const,
            kind: 'chat' as const,
            content,
            timestamp: Date.now(),
            eventType: 'chat_message',
          },
        ],
      };
    });
  },

  setStatus: (status) => set({ agentStatus: status }),

  setWaitingApproval: (waiting) => set({ waitingApproval: waiting }),

  clear: () => {
    const s = get();
    if (s._streamTimer) {
      clearTimeout(s._streamTimer);
    }
    set({
      messages: [],
      agentStatus: 'unknown',
      waitingApproval: false,
      _counter: 0,
      _turnCounter: 0,
      _streamBuffer: '',
      _streamTimer: null,
      _itemIdToMsgId: new Map<string, string>(),
      _streamingMsgIdByType: new Map<string, string>(),
    });
  },
}));
