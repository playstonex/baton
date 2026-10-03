import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useChatStore } from '../stores/chat.js';
import { wsService } from '../services/websocket.js';
import { Button } from '../lib/ui.js';
import { IconAlertCircle, IconTerminal } from '../lib/icons.js';

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

const isRunning = (s: string) => s === 'running' || s === 'thinking' || s === 'executing' || s === 'waiting_input';

export function ChatScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { messages, agentStatus, pendingApproval, approvalDetail, addEvent, addUserMessage, setStatus, resolveApproval, clear } = useChatStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

    const unsubState = wsService.on('_state', () => {
      if (wsService.connected) attachSession();
    });

    if (wsService.connected) {
      attachSession();
    } else {
      wsService.connect();
    }

    return () => {
      unsubEvent();
      unsubEventHistory();
      unsubHistory();
      unsubStatus();
      unsubState();
    };
  }, [sessionId, addEvent, setStatus, clear, attachSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingApproval]);

  function sendChat() {
    if (!input.trim() || !sessionId) return;
    addUserMessage(input.trim());
    wsService.send({ type: 'chat_input', sessionId, content: input.trim() });
    setInput('');
    inputRef.current?.focus();
  }

  function sendSteer() {
    if (!input.trim() || !sessionId) return;
    addUserMessage(input.trim());
    wsService.send({ type: 'steer_input', sessionId, content: input.trim() });
    setInput('');
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }

  const running = isRunning(agentStatus);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-line-soft bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="tertiary" size="sm" onClick={() => navigate('/')} className="-ml-1.5 px-1.5">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </Button>
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[agentStatus] ?? 'bg-meta'}`} />
          <span className="text-[13px] font-medium text-fg">Chat</span>
          <span className="font-mono text-xs text-meta">{sessionId?.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
          <Button size="sm" variant="error" onClick={stopAgent}>
            Stop
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-raised text-muted">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-[13px] font-semibold text-fg-2">Start a conversation</p>
            <p className="mt-1 text-xs text-muted">Type a message below to interact with the agent</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
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
            placeholder={pendingApproval ? 'Approve or reject the pending action…' : running ? 'Type to steer the agent…' : 'Type a message…'}
            rows={1}
            disabled={pendingApproval}
            className="flex-1 resize-none rounded-sm border border-line bg-field px-3 py-2 text-[13px] text-fg placeholder:text-meta transition-colors duration-150 focus:border-accent focus-visible:focus-ring focus:outline-none disabled:opacity-50"
          />
          {running && !pendingApproval && (
            <Button size="sm" variant="secondary" onClick={sendSteer} disabled={!input.trim()}>
              <svg className="mr-1 h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          {!running && (
            <Button size="sm" variant="primary" onClick={sendChat} disabled={!input.trim()}>
              <svg className="mr-1 h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 8h14M9 2l6 6-6 6" />
              </svg>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: { role: string; content: string; eventType?: string } }) {
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

  return (
    <div className="flex justify-center">
      <span className="inline-block max-w-[90%] rounded-full bg-raised px-3 py-1 text-center text-xs text-muted">
        {msg.content}
      </span>
    </div>
  );
}
