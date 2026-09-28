import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useChatStore } from '../stores/chat.js';
import { wsService } from '../services/websocket.js';
import { Button } from '../lib/ui.js';

const STATUS_DOT: Record<string, string> = {
  running: 'bg-geist-green-600',
  thinking: 'bg-geist-blue-600',
  executing: 'bg-geist-blue-600',
  waiting_input: 'bg-geist-amber-600',
  stopped: 'bg-geist-red-600',
  error: 'bg-geist-red-600',
  idle: 'bg-geist-gray-500',
  starting: 'bg-geist-gray-500',
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button variant="tertiary" size="sm" onClick={() => navigate('/')} className="-ml-1 text-geist-gray-800">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </Button>
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[agentStatus] ?? 'bg-geist-gray-500'}`} />
          <span className="text-sm font-medium text-geist-gray-900">Chat</span>
          <span className="font-mono text-xs text-geist-gray-700">{sessionId?.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/terminal/${sessionId}`)}>
            <svg className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
              <path d="M4 7h2M4 10h5" />
            </svg>
            Terminal
          </Button>
          <Button size="sm" variant="error" onClick={stopAgent}>
            Stop
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-md)] bg-geist-gray-alpha-200">
              <svg className="h-8 w-8 text-geist-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-geist-gray-900">Start a conversation</p>
            <p className="mt-1 text-xs text-geist-gray-700">Type a message below to interact with the agent</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {pendingApproval && (
        <div className="border-t border-geist-amber-100 bg-geist-amber-100 px-4 py-3 dark:border-geist-amber-1000 dark:bg-geist-amber-1000">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="text-sm font-medium text-geist-amber-900 dark:text-geist-amber-600">
                  Agent requests approval: {approvalDetail?.toolName ?? 'action'}
                </p>
                {approvalDetail?.detail && (
                  <p className="mt-0.5 text-xs text-geist-amber-900/80 dark:text-geist-amber-600/85">{approvalDetail.detail}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={approveAction}>
                Approve
              </Button>
              <Button size="sm" variant="error" onClick={rejectAction}>
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-geist-gray-alpha-400 bg-geist-background-100 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingApproval ? 'Approve or reject the pending action…' : running ? 'Type to steer the agent…' : 'Type a message…'}
            rows={1}
            disabled={pendingApproval}
            className="flex-1 resize-none rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 px-3 py-2 text-sm text-geist-gray-1000 placeholder:text-geist-gray-700 focus:border-geist-blue-700 focus-visible:focus-ring focus:outline-none disabled:opacity-50"
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
        <div className="max-w-[80%] rounded-[var(--radius-md)] rounded-br-sm bg-geist-gray-1000 px-4 py-2.5 text-sm text-geist-background-100">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-[var(--radius-md)] rounded-bl-sm border border-geist-gray-alpha-400 bg-geist-background-100 px-4 py-2.5 text-sm text-geist-gray-1000">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.eventType === 'waiting_approval') {
    return (
      <div className="flex justify-center">
        <div className="inline-block max-w-[90%] rounded-[var(--radius-sm)] border border-geist-amber-100 bg-geist-amber-100 px-4 py-2 text-center text-sm text-geist-amber-900 dark:border-geist-amber-1000 dark:bg-geist-amber-1000 dark:text-geist-amber-600">
          ⚠️ {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <span className="inline-block max-w-[90%] rounded-full bg-geist-gray-alpha-200 px-3 py-1 text-center text-xs text-geist-gray-900">
        {msg.content}
      </span>
    </div>
  );
}
