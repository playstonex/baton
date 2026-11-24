import { useEffect, useMemo } from 'react';
import { createStore, type StateCreator, type StoreApi } from 'zustand';
import type {
  ChatImage,
  ParsedEvent,
  StatusDetail,
  UserInputPromptEvent,
  PermissionRequestEvent,
} from '@baton/shared';

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
  /** Optimistic-send delivery state; resolved by the daemon's ack. */
  delivery?: 'pending' | 'failed';
}

interface InternalState {
  _counter: number;
  _turnCounter: number;
  _streamBuffer: string;
  _streamTimer: ReturnType<typeof setTimeout> | null;
  _itemIdToMsgId: Map<string, string>;
  _streamingMsgIdByType: Map<string, string>;
  /** Every event applied, in order — the source for rebuilding on prepend. */
  _events: ParsedEvent[];
}

/** Where "load earlier" continues from (daemon event_history cursor). */
export interface HistoryCursor {
  beforeSeq?: number | null;
  hasMore?: boolean;
}

interface ChatState extends InternalState {
  messages: ChatMessage[];
  agentStatus: string;
  /** Live activity context for the current status (daemon v2.3+). */
  statusDetail: StatusDetail | undefined;
  waitingApproval: boolean;
  activePrompt: UserInputPromptEvent | null;
  activePermission: PermissionRequestEvent | null;
  promptQueue: string[];
  sessionOwner: 'local' | 'remote' | null;
  /** Store seq to page back from; null when the daemon gave no cursor. */
  historyCursor: number | null;
  /** True when the daemon has events older than what is loaded. */
  hasOlderHistory: boolean;
  addEvent: (event: ParsedEvent) => void;
  /**
   * Replace the transcript with a full daemon replay. Messages the daemon
   * never confirmed (pending/failed sends) survive and stay retryable.
   */
  applyReplay: (events: ParsedEvent[], cursor?: HistoryCursor) => void;
  /** Prepend an older page of events ("load earlier"). */
  prependHistory: (events: ParsedEvent[], cursor: HistoryCursor) => void;
  addUserMessage: (content: string, messageId?: string, images?: ChatImage[]) => void;
  /** Resolve an optimistic send by the daemon ack's messageId. */
  resolveDelivery: (messageId: string, ok: boolean) => void;
  /** Flip a failed send back to pending under a fresh messageId (retry). */
  retryMessage: (id: string, messageId: string) => void;
  setStatus: (status: string, detail?: StatusDetail) => void;
  setSessionOwner: (owner: 'local' | 'remote' | null) => void;
  setWaitingApproval: (waiting: boolean) => void;
  setActivePrompt: (prompt: UserInputPromptEvent | null) => void;
  setActivePermission: (perm: PermissionRequestEvent | null) => void;
  enqueuePrompt: (prompt: string) => void;
  dequeuePrompt: () => string | undefined;
  removeQueuedPrompt: (index: number) => void;
  clearQueue: () => void;
  clear: () => void;
}

const STREAM_THROTTLE_MS = 80;

/**
 * PTY raw_output events deliberately preserve ANSI escapes on the wire (the
 * terminal view needs them); the chat transcript only wants plain text, so
 * strip CSI/OSC/other escape sequences before buffering. C0 controls except
 * tab/newline are dropped too — TUI redraw junk must never reach a bubble.
 */
const ANSI_ESCAPE =
  /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-_Z\\-_]|\r(?!\n)|\u0008/g;

/** Clean up orphan ANSI fragments (e.g. from chunks split mid-sequence like 38;2;...m or >4;2m) */
const ORPHAN_ANSI = /(?:^|\s)(?:>?[0-9;]+[mu]|[0-9]+;[0-9;]+m|4m>4;2m>5u)(?:\s|$)/g;

function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_ESCAPE, '').replace(ORPHAN_ANSI, ' ');
}

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
    // Optimistic sends carry a messageId — two image-only messages both read
    // "(image)" and must not collapse into one during the idle prune.
    const key = `${m.kind}:${m.content}:${m.itemId ?? ''}:${(m.meta?.messageId as string) ?? ''}`;
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

/** End the streaming state of the open thinking block, if any. */
function settleThinking(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const id = get()._streamingMsgIdByType.get('thinking');
  if (!id) return;
  set((s) => {
    const streaming = new Map(s._streamingMsgIdByType);
    streaming.delete('thinking');
    return {
      _streamingMsgIdByType: streaming,
      messages: s.messages.map((m) => (m.id === id && m.isStreaming ? { ...m, isStreaming: false } : m)),
    };
  });
}

function cursorState(cursor?: HistoryCursor): Pick<ChatState, 'historyCursor' | 'hasOlderHistory'> {
  const beforeSeq = cursor?.beforeSeq ?? null;
  return { historyCursor: beforeSeq, hasOlderHistory: beforeSeq !== null && !!cursor?.hasMore };
}

/** A daemon echo this close to (or after) an optimistic send counts as it. */
const ECHO_SKEW_MS = 60_000;

/**
 * Rebuild the transcript from `events`, keeping what the daemon can't know
 * about: unconfirmed sends, the prompt queue and session ownership. A pending
 * send whose echo is in the replay was delivered (ack lost) and is dropped.
 */
function rebuildFromEvents(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  events: ParsedEvent[],
): void {
  const before = get();
  const unsent = before.messages.filter((m) => m.delivery === 'pending' || m.delivery === 'failed');
  const kept = { promptQueue: before.promptQueue, sessionOwner: before.sessionOwner };
  get().clear();
  set(kept);
  for (const e of events) get().addEvent(e);
  flushStream(set, get);
  if (unsent.length === 0) return;

  set((s) => {
    const echoes = s.messages.filter((m) => m.role === 'user' && !m.delivery);
    const claimed = new Set<string>();
    let counter = s._counter;
    let turn = s._turnCounter;
    const restored: ChatMessage[] = [];
    for (const m of unsent) {
      if (m.delivery === 'pending') {
        const echo = echoes.find(
          (e) =>
            !claimed.has(e.id) &&
            e.content === m.content &&
            e.timestamp >= m.timestamp - ECHO_SKEW_MS,
        );
        if (echo) {
          claimed.add(echo.id);
          continue;
        }
      }
      counter++;
      turn++;
      restored.push({ ...m, id: `m-${counter}`, turnId: `t-${turn}` });
    }
    return {
      messages: [...s.messages, ...restored],
      _counter: counter,
      _turnCounter: turn,
    };
  });
}

const initChatState: StateCreator<ChatState> = (set, get) => ({
  messages: [],
  agentStatus: 'unknown',
  statusDetail: undefined,
  waitingApproval: false,
  activePrompt: null,
  activePermission: null,
  promptQueue: [],
  sessionOwner: null,
  historyCursor: null,
  hasOlderHistory: false,
  _counter: 0,
  _turnCounter: 0,
  _streamBuffer: '',
  _streamTimer: null,
  _itemIdToMsgId: new Map<string, string>(),
  _streamingMsgIdByType: new Map<string, string>(),
  _events: [],

  applyReplay: (events, cursor) => {
    rebuildFromEvents(set, get, events);
    set(cursorState(cursor));
  },

  prependHistory: (events, cursor) => {
    const s = get();
    // Status and open prompts are live state, not transcript: keep them.
    const live = {
      agentStatus: s.agentStatus,
      statusDetail: s.statusDetail,
      waitingApproval: s.waitingApproval,
      activePrompt: s.activePrompt,
      activePermission: s.activePermission,
    };
    rebuildFromEvents(set, get, [...events, ...s._events]);
    set({ ...live, ...cursorState(cursor) });
    // Settle bubbles the rebuild left streaming when the turn is over.
    if (live.agentStatus === 'idle' || live.agentStatus === 'stopped') {
      get().setStatus(live.agentStatus);
    }
  },

  addEvent: (event) => {
    // Internal log only (never rendered), so an in-place push is fine.
    get()._events.push(event);
    if (__DEV__ && (event.type === 'chat_message' || event.type === 'status_change')) {
      const contentLen =
        'content' in event ? ((event as { content?: string }).content?.length ?? 0) : 0;
      console.log(
        `[chat] addEvent type=${event.type} role=${'role' in event ? (event as { role?: string }).role : ''} contentLen=${contentLen} status=${'status' in event ? (event as { status?: string }).status : ''}`,
      );
    }
    if (event.type === 'raw_output') {
      const content = stripAnsiCodes(event.content);
      if (!content.trim()) return;

      if (event.itemId) {
        const existingMsgId = get()._itemIdToMsgId.get(event.itemId);
        if (existingMsgId) {
          set((s) => {
            const msgs = [...s.messages];
            const idx = msgs.findIndex((m) => m.id === existingMsgId);
            if (idx >= 0) {
              msgs[idx] = { ...msgs[idx], content: msgs[idx].content + content };
            }
            return { messages: msgs };
          });
          return;
        }
      }

      set((s) => ({
        _streamBuffer: s._streamBuffer + content,
        _streamTimer: s._streamTimer ?? setTimeout(() => flushStream(set, get), STREAM_THROTTLE_MS),
      }));
      return;
    }

    if (get()._streamBuffer) {
      flushStream(set, get);
    }

    // The agent moved past its reasoning (a reply, a tool call, a prompt...):
    // stop the "Thinking" animation on that block now instead of waiting for
    // the turn to go idle, or it keeps pulsing above the answer it produced.
    if (
      event.type !== 'thinking' &&
      event.type !== 'status_change' &&
      event.type !== 'turn_boundary' &&
      event.type !== 'token_usage'
    ) {
      settleThinking(set, get);
    }

    set((state) => {
      const ts = event.timestamp;
      const tid = currentTurnId(state);
      const itemId = 'itemId' in event ? (event as { itemId?: string }).itemId : undefined;

      // Status is owned by the daemon's `status_update` (see setStatus). Raw
      // status_change / turn_boundary events are parser-reported and can be
      // rejected by the daemon's state machine, so they never write
      // agentStatus here — doing so is how the UI drifted from the daemon.
      if (event.type === 'status_change') return state;

      if (event.type === 'turn_boundary') return state;

      if (event.type === 'checkpoint_created') {
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        return {
          _counter: newCounter,
          messages: [
            ...state.messages,
            {
              id,
              turnId: event.turnId || tid,
              role: 'system' as const,
              kind: 'fileChange' as const,
              content: `${event.label} (${event.files.length} file${event.files.length !== 1 ? 's' : ''})`,
              timestamp: ts,
              eventType: 'checkpoint_created',
              meta: {
                checkpointId: event.checkpointId,
                files: event.files,
                headSha: event.headSha,
                label: event.label,
              },
            },
          ],
        };
      }

      if (event.type === 'waiting_approval') {
        return { waitingApproval: true };
      }

      if (event.type === 'permission_request') {
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        return {
          _counter: newCounter,
          waitingApproval: true,
          activePermission: event,
          messages: [
            ...state.messages,
            {
              id,
              turnId: tid,
              role: 'system' as const,
              kind: 'chat' as const,
              content: event.description || `Permission requested: ${event.action}`,
              timestamp: ts,
              eventType: 'permission_request',
              meta: {
                requestId: event.requestId,
                tool: event.tool,
                action: event.action,
                description: event.description,
              },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'permission_response') {
        return {
          waitingApproval: false,
          activePermission: null,
        };
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
        // Streaming providers emit assistant text in arbitrary fragments: an
        // ACP agent_message_chunk carries whatever the agent flushed, so one
        // reply arrives as "个主", "题提交，或", "者先", … — one event each.
        // Appending them to the active assistant message rebuilds the
        // sentence; a message per event shattered one reply into dozens of
        // bubbles. raw_output and thinking already coalesce this way.
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          const existingId = state._itemIdToMsgId.get(itemId)!;
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === existingId);
          if (idx >= 0) {
            msgs[idx] = { ...msgs[idx], content: msgs[idx].content + event.content };
            return { messages: msgs };
          }
        }

        const streamingId = state._streamingMsgIdByType.get('chat_message');
        if (streamingId) {
          const last = state.messages[state.messages.length - 1];
          // Merge only while the target is still the trailing message of this
          // turn. Anything in between — a tool card, a status note, the next
          // user prompt — means the agent moved on, so the text starts a new
          // block instead of being glued onto a stale bubble.
          if (last && last.id === streamingId && last.turnId === tid) {
            const msgs = [...state.messages];
            msgs[msgs.length - 1] = { ...last, content: last.content + event.content };
            return { messages: msgs };
          }
        }

        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (itemId) updatedItemIdMap.set(itemId, id);
        const updatedStreaming = new Map(state._streamingMsgIdByType);
        updatedStreaming.set('chat_message', id);
        return {
          _counter: newCounter,
          _itemIdToMsgId: updatedItemIdMap,
          _streamingMsgIdByType: updatedStreaming,
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
              meta: { ...(event.args as Record<string, unknown>), tool: event.tool },
              itemId,
            },
          ],
        };
      }

      if (event.type === 'tool_call_start') {
        const key = `call:${event.callId}`;
        const msgs = [...state.messages];
        let idx = state._itemIdToMsgId.has(key)
          ? msgs.findIndex((m) => m.id === state._itemIdToMsgId.get(key))
          : -1;
        if (idx < 0) {
          // The PTY parser emits tool_use first, then tool_call_start for the
          // same call — enrich that card in place instead of duplicating it.
          // Only the trailing un-claimed run of tool rows is eligible.
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.kind !== 'toolActivity') break;
            if (!m.meta?.callId && m.content.startsWith(event.tool)) {
              idx = i;
              break;
            }
          }
        }
        const updatedItemIdMap = new Map(state._itemIdToMsgId);
        if (idx >= 0) {
          updatedItemIdMap.set(key, msgs[idx].id);
          msgs[idx] = {
            ...msgs[idx],
            isStreaming: true,
            meta: {
              ...msgs[idx].meta,
              callId: event.callId,
              tool: event.tool,
              title: event.title,
              description: event.description,
              running: true,
            },
          };
          return { _itemIdToMsgId: updatedItemIdMap, messages: msgs };
        }
        // No tool_use row to attach to (adapter only emits start events) —
        // create the card here.
        const newCounter = state._counter + 1;
        const id = `m-${newCounter}`;
        updatedItemIdMap.set(key, id);
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
              content: event.title ?? event.tool,
              timestamp: ts,
              eventType: 'tool_call_start',
              isStreaming: true,
              meta: {
                ...(event.args as Record<string, unknown>),
                tool: event.tool,
                callId: event.callId,
                title: event.title,
                description: event.description,
                running: true,
              },
            },
          ],
        };
      }

      if (event.type === 'tool_call_end') {
        const targetId = state._itemIdToMsgId.get(`call:${event.callId}`);
        if (!targetId) return state;
        const msgs = [...state.messages];
        const idx = msgs.findIndex((m) => m.id === targetId);
        if (idx < 0) return state;
        msgs[idx] = {
          ...msgs[idx],
          isStreaming: false,
          meta: {
            ...msgs[idx].meta,
            running: false,
            success: event.success,
            durationMs: event.durationMs,
          },
        };
        return { messages: msgs };
      }

      if (event.type === 'file_change') {
        if (itemId && state._itemIdToMsgId.has(itemId)) {
          return state;
        }
        const icons: Record<string, string> = { create: '+', modify: '~', delete: '-' };
        const existingIdx = state.messages.findIndex(
          (m) =>
            m.kind === 'fileChange' && m.meta?.path === event.path && m.eventType === 'file_change',
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
          activePrompt: event,
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

  addUserMessage: (content, messageId, images) => {
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
            delivery: messageId ? ('pending' as const) : undefined,
            meta: {
              ...(messageId ? { messageId } : {}),
              ...(images && images.length > 0 ? { images } : {}),
            },
          },
        ],
      };
    });
  },

  resolveDelivery: (messageId, ok) => {
    set((state) => {
      const idx = state.messages.findIndex((m) => m.meta?.messageId === messageId);
      if (idx < 0) return state;
      const msgs = [...state.messages];
      const target = msgs[idx];
      if (!ok && target.delivery !== 'failed') {
        msgs[idx] = { ...target, delivery: 'failed' };
        return { messages: msgs };
      }
      if (ok && target.delivery === 'pending') {
        msgs[idx] = { ...target, delivery: undefined };
        return { messages: msgs };
      }
      return state;
    });
  },

  retryMessage: (id, messageId) => {
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx < 0) return state;
      const msgs = [...state.messages];
      msgs[idx] = {
        ...msgs[idx],
        delivery: 'pending',
        meta: { ...msgs[idx].meta, messageId },
      };
      return { messages: msgs };
    });
  },

  setStatus: (status, detail) =>
    set((state) => {
      if (status !== 'idle' && status !== 'stopped') {
        if (state.agentStatus === status && state.statusDetail === detail) return state;
        return { agentStatus: status, statusDetail: detail };
      }
      // Turn over: settle streaming bubbles and drop pending prompts.
      const msgs = pruneDuplicateMessages(
        state.messages.map((m) => {
          if (!m.isStreaming && !m.meta?.running) return m;
          const meta = m.meta ? { ...m.meta, isStreaming: false, running: false } : m.meta;
          return { ...m, isStreaming: false, meta };
        }),
      );
      return {
        agentStatus: status,
        statusDetail: undefined,
        waitingApproval: false,
        activePrompt: null,
        activePermission: null,
        messages: msgs,
        _streamingMsgIdByType: new Map<string, string>(),
      };
    }),

  setSessionOwner: (owner) => set({ sessionOwner: owner }),

  setWaitingApproval: (waiting) => set({ waitingApproval: waiting }),

  setActivePrompt: (prompt) => set({ activePrompt: prompt }),

  setActivePermission: (perm) => set({ activePermission: perm }),

  enqueuePrompt: (prompt) => {
    if (!prompt.trim()) return;
    set((s) => ({ promptQueue: [...s.promptQueue, prompt.trim()] }));
  },

  dequeuePrompt: () => {
    const queue = get().promptQueue;
    if (queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    set({ promptQueue: rest });
    return first;
  },

  removeQueuedPrompt: (index) => {
    set((s) => ({ promptQueue: s.promptQueue.filter((_, i) => i !== index) }));
  },

  clearQueue: () => {
    set({ promptQueue: [] });
  },

  clear: () => {
    const s = get();
    if (s._streamTimer) {
      clearTimeout(s._streamTimer);
    }
    set({
      messages: [],
      agentStatus: 'unknown',
      statusDetail: undefined,
      waitingApproval: false,
      activePrompt: null,
      activePermission: null,
      promptQueue: [],
      sessionOwner: null,
      historyCursor: null,
      hasOlderHistory: false,
      _counter: 0,
      _turnCounter: 0,
      _streamBuffer: '',
      _streamTimer: null,
      _itemIdToMsgId: new Map<string, string>(),
      _streamingMsgIdByType: new Map<string, string>(),
      _events: [],
    });
  },
});

export type ChatStore = StoreApi<ChatState>;

/** A standalone chat store. Screens use `useChatSessionStore`; tests use this. */
export function createChatStore(): ChatStore {
  return createStore<ChatState>()(initChatState);
}

/**
 * One store per session. The chat store used to be a single global, and every
 * mounted chat screen wrote into it: expo-router keeps screens under the top
 * of the stack mounted (still subscribed, still attached), a late HTTP/WS
 * replay from the previous screen landed after the next screen's clear(), and
 * one session's transcript, status and queued prompts showed up in another.
 * Keying the state by sessionId makes cross-session writes impossible instead
 * of relying on every handler's filter.
 */
const sessionStores = new Map<string, ChatStore>();
const retainCounts = new Map<string, number>();
/** Unretained stores kept for instant re-entry before the oldest is evicted. */
const MAX_IDLE_STORES = 4;

export function getChatStore(sessionId: string): ChatStore {
  let store = sessionStores.get(sessionId);
  if (!store) {
    store = createChatStore();
    sessionStores.set(sessionId, store);
  } else {
    // Re-insert so Map order tracks recency for eviction.
    sessionStores.delete(sessionId);
    sessionStores.set(sessionId, store);
  }
  return store;
}

function evictIdleStores(): void {
  const idle = [...sessionStores.keys()].filter((id) => !retainCounts.get(id));
  for (const id of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_STORES))) {
    sessionStores.get(id)?.getState().clear();
    sessionStores.delete(id);
  }
}

export function retainChatStore(sessionId: string): () => void {
  retainCounts.set(sessionId, (retainCounts.get(sessionId) ?? 0) + 1);
  return () => {
    const n = (retainCounts.get(sessionId) ?? 1) - 1;
    if (n > 0) retainCounts.set(sessionId, n);
    else retainCounts.delete(sessionId);
    evictIdleStores();
  };
}

/** The store for `sessionId`, kept alive while the calling component is mounted. */
export function useChatSessionStore(sessionId: string | undefined): ChatStore {
  const key = sessionId ?? '';
  const store = useMemo(() => getChatStore(key), [key]);
  useEffect(() => retainChatStore(key), [key]);
  return store;
}

/** Test hook: drop every session store. */
export function resetChatStores(): void {
  for (const s of sessionStores.values()) s.getState().clear();
  sessionStores.clear();
  retainCounts.clear();
}
