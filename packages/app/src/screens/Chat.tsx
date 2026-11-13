import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import type { PermissionMode, ModelInfo } from '@baton/shared';
import { formatModelName } from '@baton/shared';
import { useChatStore } from '../stores/chat.js';
import { wsService } from '../services/websocket.js';
import { Button } from '../lib/ui.js';
import { UsagePill } from '../components/UsagePill.js';
import { ThinkingStates, MatrixLoader, ReasoningStream } from '../components/index.js';
import {
  IconAlertCircle,
  IconTerminal,
  IconFile,
  IconGitBranch,
  IconActivity,
  IconRotateCcw,
} from '../lib/icons.js';

const PERMISSION_CONFIG: Record<string, { label: string; desc: string; tone: string }> = {
  default: { label: 'Default', desc: 'Prompts for confirmation on tool actions', tone: 'text-fg' },
  'safe-yolo': {
    label: 'Safe YOLO',
    desc: 'Auto-approves file edits; prompts on shell commands',
    tone: 'text-accent',
  },
  yolo: {
    label: 'YOLO',
    desc: 'Auto-approves all tool actions without prompting',
    tone: 'text-danger',
  },
  plan: {
    label: 'Plan Only',
    desc: 'Read-only inspection; file modifications blocked',
    tone: 'text-warn',
  },
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-success',
  thinking: 'bg-accent-hover',
  executing: 'bg-accent-hover',
  waiting_input: 'bg-warn',
  stopped: 'bg-danger',
  error: 'bg-danger',
  idle: 'bg-meta',
  starting: 'bg-meta',
};

const isRunning = (s: string) =>
  s === 'running' || s === 'thinking' || s === 'executing' || s === 'waiting_input';

export function ChatScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const {
    messages,
    agentStatus,
    pendingApproval,
    approvalDetail,
    addEvent,
    addUserMessage,
    setStatus,
    resolveApproval,
    clear,
  } = useChatStore();
  const [input, setInput] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [showPermMenu, setShowPermMenu] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelDetails, setModelDetails] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

  function handleSelectPermission(mode: PermissionMode) {
    setPermissionMode(mode);
    setShowPermMenu(false);
    if (sessionId) {
      wsService.send({
        type: 'control',
        action: 'set_permission_mode',
        sessionId,
        payload: { mode },
      });
    }
  }

  function handleSelectModel(model: string) {
    setSelectedModel(model);
    setShowModelMenu(false);
    if (sessionId) {
      wsService.send({
        type: 'model_select',
        sessionId,
        model,
      });
    }
  }

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
  }

  const attachSession = useCallback(() => {
    if (!sessionId) return;
    wsService.attachOrResume(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    clear();

    const unsubEvent = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        addEvent(msg.event);
      }
    });

    // Full event replay (first attach to an existing session, or gap
    // recovery): reset before applying so a reconnect never appends the
    // conversation on top of itself. Without this handler the web chat
    // rendered NOTHING for a session opened mid-conversation.
    const unsubEventHistory = wsService.on('event_history', (msg) => {
      if (msg.type === 'event_history' && msg.sessionId === sessionId) {
        clear();
        for (const event of msg.events) {
          addEvent(event);
        }
      }
    });

    // history_replay precedes event_history on a full re-attach; its terminal
    // text isn't chat content — use it as the "full replay started" signal.
    const unsubHistory = wsService.on('history_replay', (msg) => {
      if (msg.type === 'history_replay' && msg.sessionId === sessionId) {
        clear();
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && msg.sessionId === sessionId) {
        setStatus(msg.status as string);
      }
    });

    const unsubModels = wsService.on('model_list', (msg) => {
      if (msg.type === 'model_list' && msg.sessionId === sessionId) {
        setModels(msg.models);
        if (msg.modelDetails && Array.isArray(msg.modelDetails)) {
          setModelDetails(msg.modelDetails);
        }
        if (msg.selected) {
          setSelectedModel(msg.selected);
        }
      }
    });

    const unsubState = wsService.on('_state', () => {
      if (wsService.connected) {
        attachSession();
        wsService.send({ type: 'model_list_request', sessionId });
      }
    });

    if (wsService.connected) {
      attachSession();
      wsService.send({ type: 'model_list_request', sessionId });
    } else {
      wsService.connect();
    }

    return () => {
      unsubEvent();
      unsubEventHistory();
      unsubHistory();
      unsubStatus();
      unsubModels();
      unsubState();
    };
  }, [sessionId, addEvent, setStatus, clear, attachSession]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, pendingApproval]);

  function sendChat() {
    if (!input.trim() || !sessionId || isStopped) return;
    addUserMessage(input.trim());
    wsService.send({ type: 'chat_input', sessionId, content: input.trim() });
    setInput('');
    isNearBottomRef.current = true;
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    inputRef.current?.focus();
  }

  function sendSteer() {
    if (!input.trim() || !sessionId || isStopped) return;
    addUserMessage(input.trim());
    wsService.send({ type: 'steer_input', sessionId, content: input.trim() });
    setInput('');
    isNearBottomRef.current = true;
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    inputRef.current?.focus();
  }

  function cancelTurn() {
    if (!sessionId) return;
    wsService.send({ type: 'cancel_turn', sessionId });
  }

  function approveAction() {
    if (!sessionId) return;
    wsService.send({ type: 'approve_input', sessionId, reason: 'Approved via Baton' });
    resolveApproval();
  }

  function rejectAction() {
    if (!sessionId) return;
    wsService.send({ type: 'reject_input', sessionId, reason: 'Rejected via Baton' });
    resolveApproval();
  }

  function stopAgent() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'stop_agent', sessionId });
    navigate('/');
  }

  async function handleRollback(checkpointId: string) {
    if (!sessionId) return;
    if (
      !confirm(
        `Rollback workspace to checkpoint ${checkpointId}? Any modifications made after this turn will be restored to this exact snapshot.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/agents/${sessionId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Rollback failed');
      } else {
        alert(`Workspace successfully rolled back to ${checkpointId}.`);
      }
    } catch {
      alert('Failed to reach daemon for rollback');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStopped) return;
      if (running && !pendingApproval) {
        sendSteer();
      } else if (!pendingApproval) {
        sendChat();
      }
    }
  }

  const isStopped = agentStatus === 'stopped' || agentStatus === 'error';
  const running = isRunning(agentStatus) && !isStopped;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-line-soft bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => navigate('/')}
            className="-ml-1.5 px-1.5"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 12L6 8l4-4" />
            </svg>
          </Button>
          <span
            className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[agentStatus] ?? 'bg-meta'}`}
          />
          <span className="text-[13px] font-medium text-fg">Chat</span>
          <span className="font-mono text-xs text-meta">{sessionId?.slice(0, 8)}</span>
          {running && (
            <div className="hidden items-center gap-2 border-l border-line-soft pl-2.5 sm:flex">
              <MatrixLoader variant="scan" />
              <ThinkingStates
                states={[
                  agentStatus === 'thinking' ? 'Agent thinking…' : 'Agent executing…',
                  'Analyzing context',
                  'Checking workspace',
                  'Synthesizing turn',
                ]}
                className="font-mono text-xs text-meta"
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          {models.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1.5 rounded-full border border-line-soft bg-field px-2.5 py-1 text-xs transition-colors hover:brightness-105"
                title="Active Model"
              >
                <span className="text-meta">Model:</span>
                <span className="font-medium text-fg">
                  {formatModelName(selectedModel ?? models[0], { modelDetails, compact: true })}
                </span>
              </button>

              {showModelMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
                  <div className="absolute right-0 top-8 z-50 w-72 max-h-96 overflow-y-auto rounded-md border border-line-soft bg-surface p-1.5 shadow-lg">
                    <div className="px-2 py-1 text-[11px] font-medium text-meta">
                      Select Agent Model
                    </div>
                    {models.map((modelId) => {
                      const isCurrent = modelId === (selectedModel ?? models[0]);
                      const detail = modelDetails.find((d) => d.id === modelId);
                      const displayName = formatModelName(modelId, { modelDetails });
                      return (
                        <button
                          key={modelId}
                          type="button"
                          onClick={() => handleSelectModel(modelId)}
                          className={`flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-raised ${
                            isCurrent ? 'bg-raised/70' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between w-full text-xs font-medium">
                            <span className={isCurrent ? 'text-accent font-semibold' : 'text-fg'}>
                              {displayName}
                            </span>
                            {isCurrent && <span className="text-[10px] text-accent">✓ Active</span>}
                          </div>
                          {detail?.description && (
                            <span className="text-[11px] text-muted line-clamp-1">
                              {detail.description}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Permission Mode Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPermMenu(!showPermMenu)}
              className="flex items-center gap-1.5 rounded-full border border-line-soft bg-field px-2.5 py-1 text-xs transition-colors hover:brightness-105"
              title="Agent Permission Mode"
            >
              <span className="text-meta">Perm:</span>
              <span
                className={`font-medium ${PERMISSION_CONFIG[permissionMode]?.tone ?? 'text-fg'}`}
              >
                {PERMISSION_CONFIG[permissionMode]?.label ?? permissionMode}
              </span>
            </button>

            {showPermMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPermMenu(false)} />
                <div className="absolute right-0 top-8 z-50 w-64 rounded-md border border-line-soft bg-surface p-1.5 shadow-lg">
                  <div className="px-2 py-1 text-[11px] font-medium text-meta">
                    Permission Resolution Mode
                  </div>
                  {Object.entries(PERMISSION_CONFIG).map(([key, item]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectPermission(key as PermissionMode)}
                      className={`flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-raised ${
                        permissionMode === key ? 'bg-raised/70' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span className={item.tone}>{item.label}</span>
                        {permissionMode === key && (
                          <span className="text-[10px] text-accent">✓ Active</span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <UsagePill />
          <Button size="sm" variant="secondary" onClick={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/git/${sessionId}`)}>
            <IconGitBranch className="mr-1.5 h-3.5 w-3.5" />
            Git
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/agent/${sessionId}`)}>
            <IconActivity className="mr-1.5 h-3.5 w-3.5" />
            Events
          </Button>
          <Button size="sm" variant="error" onClick={stopAgent}>
            Stop
          </Button>
        </div>
      </div>

      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-raised text-muted">
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-[13px] font-semibold text-fg-2">Start a conversation</p>
            <p className="mt-1 text-xs text-muted">
              Type a message below to interact with the agent
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} onRollback={handleRollback} />
            ))}
            {running && !pendingApproval && (
              <div className="flex items-center gap-2.5 rounded-md border border-accent/20 bg-accent-soft/30 px-3.5 py-2">
                <MatrixLoader variant="orbit" />
                <ThinkingStates
                  states={[
                    agentStatus === 'thinking' ? 'Claude is thinking…' : 'Executing command…',
                    'Processing agent output',
                    'Checking tool feedback',
                    'Preparing response',
                  ]}
                  className="text-xs font-medium text-fg-2"
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {pendingApproval && (
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-md border border-warn/25 bg-warn-soft px-4 py-3">
          <div className="flex items-center gap-2.5">
            <IconAlertCircle className="h-4 w-4 shrink-0 text-warn" />
            <div>
              <p className="text-[13px] font-medium text-fg">
                Agent requests approval: {approvalDetail?.toolName ?? 'action'}
              </p>
              {approvalDetail?.detail && (
                <p className="mt-0.5 text-xs text-muted">{approvalDetail.detail}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="primary" onClick={approveAction}>
              Approve
            </Button>
            <Button size="sm" variant="error" onClick={rejectAction}>
              Reject
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-line-soft bg-surface p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStopped
                ? 'Agent session has stopped'
                : pendingApproval
                  ? 'Approve or reject the pending action…'
                  : running
                    ? 'Type to steer the agent…'
                    : 'Type a message…'
            }
            rows={1}
            disabled={pendingApproval || isStopped}
            className="flex-1 resize-none rounded-sm border border-line bg-field px-3 py-2 text-[13px] text-fg placeholder:text-meta transition-colors duration-150 focus:border-accent focus-visible:focus-ring focus:outline-none disabled:opacity-50"
          />
          {running && !pendingApproval && (
            <Button size="sm" variant="secondary" onClick={sendSteer} disabled={!input.trim()}>
              <svg
                className="mr-1 h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 1l6 6-6 6" />
                <path d="M7 1l6 6-6 6" />
              </svg>
              Steer
            </Button>
          )}
          {running && !pendingApproval && (
            <Button size="sm" variant="secondary" onClick={cancelTurn}>
              Cancel
            </Button>
          )}
          {!running && !isStopped && (
            <Button size="sm" variant="primary" onClick={sendChat} disabled={!input.trim()}>
              <svg
                className="mr-1 h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 8h14M9 2l6 6-6 6" />
              </svg>
              Send
            </Button>
          )}
          {isStopped && (
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              Dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onRollback,
}: {
  msg: { role: string; content: string; eventType?: string; meta?: Record<string, unknown> };
  onRollback?: (cpId: string) => void;
}) {
  if (msg.eventType === 'checkpoint_created') {
    const cpId = msg.meta?.checkpointId as string | undefined;
    return (
      <div className="flex justify-center my-1.5">
        <div className="inline-flex max-w-[90%] items-center gap-2.5 rounded-md border border-line-soft bg-surface/90 px-3.5 py-1.5 text-xs text-muted shadow-xs">
          <IconGitBranch className="h-3.5 w-3.5 text-accent" />
          <span className="font-mono text-fg-2">{msg.content}</span>
          {cpId && (
            <button
              type="button"
              onClick={() => onRollback?.(cpId)}
              className="inline-flex items-center gap-1 rounded bg-raised px-2 py-0.5 text-[11px] font-medium text-warn hover:bg-warn/10 transition-colors"
              title="Rollback workspace to this turn"
            >
              <IconRotateCcw className="h-3 w-3" />
              <span>Rollback</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-md rounded-br-sm bg-accent px-4 py-2.5 text-[13px] leading-relaxed text-accent-on">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-md rounded-bl-sm border border-line-soft bg-raised px-4 py-2.5 text-[13px] leading-relaxed text-fg">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.eventType === 'waiting_approval') {
    return (
      <div className="flex justify-center">
        <div className="inline-flex max-w-[90%] items-start gap-2 rounded-sm border border-warn/25 bg-warn-soft px-4 py-2 text-center text-[13px] text-fg">
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>{msg.content}</span>
        </div>
      </div>
    );
  }

  if (msg.eventType === 'error') {
    return (
      <div className="flex justify-center">
        <div className="inline-flex max-w-[90%] items-center gap-2 rounded-sm border border-danger/25 bg-danger/10 px-4 py-2 text-center text-[13px] text-danger">
          <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{msg.content}</span>
        </div>
      </div>
    );
  }

  if (msg.eventType === 'command_exec') {
    return (
      <div className="flex justify-center">
        <span className="inline-block max-w-[90%] rounded-sm border border-line-soft bg-canvas px-3 py-1 font-mono text-xs text-fg-2">
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.eventType === 'thinking') {
    const isMultiLine = msg.content.includes('\n') || msg.content.length > 80;
    return (
      <div className="flex justify-center my-1.5">
        {isMultiLine ? (
          <div className="w-full max-w-xl rounded-md border border-line-soft bg-surface/90 p-3 shadow-xs">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-meta">
              <MatrixLoader variant="pulse" />
              <span>Reasoning transcript</span>
            </div>
            <ReasoningStream maxHeight={72} className="text-xs font-mono leading-relaxed text-fg-2">
              {msg.content}
            </ReasoningStream>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-line-soft bg-surface px-3 py-1 text-xs text-meta shadow-xs">
            <MatrixLoader variant="scan" />
            <ThinkingStates text={msg.content} className="font-mono text-xs text-meta" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <span className="inline-block max-w-[90%] rounded-full bg-raised px-3 py-1 text-center text-xs text-muted">
        {msg.content}
      </span>
    </div>
  );
}
