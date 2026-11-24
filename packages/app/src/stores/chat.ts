import { useEffect, useMemo } from 'react';
import { createStore, type StateCreator, type StoreApi } from 'zustand';
import type { ParsedEvent } from '@baton/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, unknown>;
  /** Full text behind a one-line summary (tool args, command output, diff). */
  detail?: string;
  /** Provider item id, used to update a message in place. */
  itemId?: string;
  /** Thinking blocks: true once the agent moved on to something else. */
  done?: boolean;
  /** A turn ended here; the next assistant text starts a new bubble. */
  sealed?: boolean;
}

export interface ApprovalDetail {
  requestId?: string;
  toolName: string;
  detail: string;
  input?: Record<string, unknown>;
  canRemember?: boolean;
}

export interface PendingQuestion {
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{ label: string; description: string }>;
  }>;
}

interface ChatState {
  messages: ChatMessage[];
  agentStatus: string;
  pendingApproval: boolean;
  approvalDetail: ApprovalDetail | null;
  approvalQueue: ApprovalDetail[];
  pendingQuestion: PendingQuestion | null;
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

/** Mark every open thinking block finished. */
function closeThinking(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.some((m) => m.eventType === 'thinking' && !m.done)) return messages;
  return messages.map((m) => (m.eventType === 'thinking' && !m.done ? { ...m, done: true } : m));
}

function sealLast(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.sealed) return messages;
  return [...messages.slice(0, -1), { ...last, sealed: true }];
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function approvalState(queue: ApprovalDetail[]) {
  return {
    approvalQueue: queue,
    pendingApproval: queue.length > 0,
    approvalDetail: queue[0] ?? null,
  };
}

const initChatState: StateCreator<ChatState> = (set) => ({
  messages: [],
  agentStatus: 'unknown',
  pendingApproval: false,
  approvalDetail: null,
  approvalQueue: [],
  pendingQuestion: null,

  addEvent: (rawEvent) =>
    set((current) => {
      const id = `msg-${++msgCounter}`;
      const event = rawEvent;
      const ts = event.timestamp;
      // Anything other than more reasoning ends the open thinking block.
      const state =
        event.type === 'thinking' || event.type === 'status_change'
          ? current
          : { ...current, messages: closeThinking(current.messages) };

      // Status comes only from the daemon's `status_update` (see setStatus);
      // raw status_change events can disagree with the authoritative value.
      if (event.type === 'status_change') return state;

      if (event.type === 'chat_message') {
        if (event.role === 'user') {
          const last = state.messages[state.messages.length - 1];
          if (last?.role === 'user' && last?.content === event.content) {
            return state.pendingQuestion ? { pendingQuestion: null } : state;
          }
        } else {
          // Streaming providers emit assistant text in arbitrary fragments —
          // an ACP agent_message_chunk carries whatever the agent flushed — so
          // one reply arrives as many chat_message events. Append to the
          // trailing assistant bubble, the same way raw_output coalesces
          // below; a message per event shatters one reply into dozens.
          const messages = [...state.messages];
          const last = messages[messages.length - 1];
          if (last?.eventType === 'chat_message' && last.role === event.role && !last.sealed) {
            messages[messages.length - 1] = {
              ...last,
              content: last.content + event.content,
            };
            return {
              messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
            };
          }
        }
        return {
          pendingQuestion: event.role === 'user' ? null : state.pendingQuestion,
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
        if (last?.eventType === 'raw_output' && !last.sealed) {
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
        const isPerm = event.type === 'permission_request';
        const toolName = isPerm
          ? event.tool || event.action || 'action'
          : ((meta?.toolName ?? 'action') as string);
        const detail = isPerm ? event.description || '' : ((meta?.detail ?? '') as string);
        const entry: ApprovalDetail = {
          requestId: isPerm ? event.requestId : undefined,
          toolName,
          detail,
          input: isPerm ? event.input : undefined,
          canRemember: isPerm ? event.canRemember : undefined,
        };
        const queue = [
          ...state.approvalQueue.filter((a) => !entry.requestId || a.requestId !== entry.requestId),
          entry,
        ];
        return {
          ...approvalState(queue),
          messages: push(state.messages, [
            {
              id,
              role: 'system' as const,
              content: `Approval required: ${toolName}${detail ? ` — ${detail}` : ''}`,
              detail: entry.input ? stringify(entry.input) : undefined,
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
        const idx = state.approvalQueue.findIndex((a) => a.requestId === event.requestId);
        const queue = state.approvalQueue.filter((_, i) => (idx >= 0 ? i !== idx : i !== 0));
        return {
          ...approvalState(queue),
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
          pendingQuestion: questions.length > 0 ? { questions } : null,
          messages: push(state.messages, [
            {
              id,
              role: 'assistant' as const,
              content: content || 'Question from agent',
              timestamp: ts,
              eventType: 'user_input_prompt',
              sealed: true,
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
              detail: stringify(event.args),
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
              detail: event.steps?.map((st) => `- ${st.step}`).join('\n'),
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
              detail: event.diff,
              timestamp: ts,
              eventType: 'diff',
            },
          ]),
        };
      }

      if (event.type === 'thinking') {
        const last = current.messages[current.messages.length - 1];
        if (last?.eventType === 'thinking' && !last.done) {
          const messages = [...current.messages];
          messages[messages.length - 1] = {
            ...last,
            content: last.content + (event.content ?? ''),
          };
          return { messages };
        }
        return {
          messages: push(closeThinking(current.messages), [
            {
              id,
              role: 'system',
              content: event.content ?? '',
              timestamp: ts,
              eventType: 'thinking',
              done: false,
            },
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
        const next: ChatMessage = {
          id,
          role: 'system',
          content: `$ ${event.command}`,
          detail: event.output,
          itemId: event.itemId,
          timestamp: ts,
          eventType: 'command_exec',
          meta: event.exitCode !== undefined ? { exitCode: event.exitCode } : undefined,
        };
        const at = event.itemId
          ? state.messages.findIndex(
              (m) => m.eventType === 'command_exec' && m.itemId === event.itemId,
            )
          : -1;
        if (at >= 0) {
          const messages = [...state.messages];
          messages[at] = { ...next, id: messages[at].id };
          return { messages };
        }
        return { messages: push(state.messages, [next]) };
      }

      if (event.type === 'turn_boundary') {
        return { messages: sealLast(state.messages) };
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
    set((state) => {
      const waiting = status === 'waiting_input';
      const turnOver = !isBusy(status) && status !== 'unknown' && status !== 'starting';
      let messages = state.messages;
      if (status !== 'thinking') messages = closeThinking(messages);
      if (turnOver) messages = sealLast(messages);
      return {
        agentStatus: status,
        messages,
        ...(waiting ? {} : approvalState([])),
        pendingQuestion: waiting ? state.pendingQuestion : null,
      };
    }),

  resolveApproval: () => set((state) => approvalState(state.approvalQueue.slice(1))),

  clear: () =>
    set({
      messages: [],
      agentStatus: 'unknown',
      pendingQuestion: null,
      ...approvalState([]),
    }),
});

export type ChatStore = StoreApi<ChatState>;

/** A standalone chat store. Screens use `useChatSessionStore`; tests use this. */
export function createChatStore(): ChatStore {
  return createStore<ChatState>()(initChatState);
}

/**
 * One store per session, so a replay or live event for one session can never
 * land in another session's transcript — whatever is mounted, and whatever
 * order async replies arrive in. Same design as the mobile app's chat store.
 */
const sessionStores = new Map<string, ChatStore>();
const retainCounts = new Map<string, number>();
/** Unretained stores kept for instant re-entry before the oldest is evicted. */
const MAX_IDLE_STORES = 4;

export function getChatStore(sessionId: string): ChatStore {
  let store = sessionStores.get(sessionId);
  if (!store) store = createChatStore();
  // (Re-)insert so Map order tracks recency for eviction.
  sessionStores.delete(sessionId);
  sessionStores.set(sessionId, store);
  return store;
}

export function retainChatStore(sessionId: string): () => void {
  retainCounts.set(sessionId, (retainCounts.get(sessionId) ?? 0) + 1);
  return () => {
    const n = (retainCounts.get(sessionId) ?? 1) - 1;
    if (n > 0) retainCounts.set(sessionId, n);
    else retainCounts.delete(sessionId);
    const idle = [...sessionStores.keys()].filter((id) => !retainCounts.get(id));
    for (const id of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_STORES))) {
      sessionStores.delete(id);
    }
  };
}

/** The store for `sessionId`, kept alive while the calling component is mounted. */
export function useChatSessionStore(sessionId: string | undefined): ChatStore {
  const key = sessionId ?? '';
  const store = useMemo(() => getChatStore(key), [key]);
  useEffect(() => retainChatStore(key), [key]);
  return store;
}

function isBusy(status: string): boolean {
  return (
    status === 'running' ||
    status === 'thinking' ||
    status === 'executing' ||
    status === 'waiting_input'
  );
}
