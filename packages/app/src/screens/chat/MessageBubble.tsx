import { useEffect, useState } from 'react';
import { MatrixLoader, ReasoningStream } from '../../components/index.js';
import { IconAlertCircle, IconGitBranch, IconRotateCcw } from '../../lib/icons.js';
import type { ChatMessage } from '../../stores/chat.js';

const COLLAPSE_CHARS = 700;
const COLLAPSE_LINES = 14;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Non-secure contexts (plain http on a LAN) have no async clipboard.
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(el);
    }
  }
}

function isLong(text: string): boolean {
  return text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="rounded px-1.5 py-0.5 text-[11px] text-meta hover:bg-raised hover:text-fg"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Full-content viewer: the in-bubble preview is clipped, this is not. */
function ViewerModal({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col rounded-md border border-line-soft bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-2">
          <span className="truncate text-[13px] font-medium text-fg">{title}</span>
          <div className="flex items-center gap-1">
            <CopyButton text={text} />
            <button
              type="button"
              onClick={onClose}
              className="rounded px-1.5 py-0.5 text-[11px] text-meta hover:bg-raised hover:text-fg"
            >
              Close
            </button>
          </div>
        </div>
        <pre className="flex-1 select-text overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-fg">
          {text}
        </pre>
      </div>
    </div>
  );
}

/** Text body that clips long content and offers expand / open-in-viewer / copy. */
function CollapsibleText({
  text,
  title,
  className,
  actionTone = '',
}: {
  text: string;
  title: string;
  className: string;
  actionTone?: string;
}) {
  const long = isLong(text);
  const [expanded, setExpanded] = useState(false);
  const [viewing, setViewing] = useState(false);
  return (
    <div className="group max-w-[80%]">
      <div
        className={`select-text whitespace-pre-wrap break-words ${className} ${
          long && !expanded ? 'max-h-60 overflow-hidden' : ''
        }`}
      >
        {text}
      </div>
      <div
        className={`mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${actionTone}`}
      >
        <CopyButton text={text} />
        {long && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded px-1.5 py-0.5 text-[11px] text-meta hover:bg-raised hover:text-fg"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button
              type="button"
              onClick={() => setViewing(true)}
              className="rounded px-1.5 py-0.5 text-[11px] text-meta hover:bg-raised hover:text-fg"
            >
              Open
            </button>
          </>
        )}
      </div>
      {viewing && <ViewerModal title={title} text={text} onClose={() => setViewing(false)} />}
    </div>
  );
}

/** One-line system row (tool call, command, diff) that expands to its full detail. */
function DetailRow({
  summary,
  detail,
  mono,
  tone = 'border-line-soft bg-raised text-muted',
}: {
  summary: string;
  detail?: string;
  mono?: boolean;
  tone?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const hasDetail = !!detail && detail.trim().length > 0;
  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] min-w-0">
        <div
          className={`inline-flex max-w-full items-center gap-2 rounded-sm border px-3 py-1 text-xs ${tone} ${
            mono ? 'font-mono' : ''
          }`}
        >
          <span className="select-text truncate" title={summary}>
            {summary}
          </span>
          {hasDetail && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="shrink-0 text-[11px] text-meta hover:text-fg"
            >
              {open ? 'Hide' : 'Details'}
            </button>
          )}
          <CopyButton text={hasDetail ? `${summary}\n${detail}` : summary} />
        </div>
        {open && hasDetail && (
          <div className="mt-1 rounded-sm border border-line-soft bg-canvas">
            <pre className="max-h-72 select-text overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-fg-2">
              {detail}
            </pre>
            <div className="border-t border-line-soft px-2 py-1">
              <button
                type="button"
                onClick={() => setViewing(true)}
                className="text-[11px] text-meta hover:text-fg"
              >
                Open in viewer
              </button>
            </div>
          </div>
        )}
        {viewing && (
          <ViewerModal title={summary} text={detail ?? ''} onClose={() => setViewing(false)} />
        )}
      </div>
    </div>
  );
}

function ThinkingBlock({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const text = msg.content.trim();
  const live = !msg.done;
  return (
    <div className="flex justify-center my-1.5">
      <div className="w-full max-w-xl rounded-md border border-line-soft bg-surface/90 px-3 py-2 shadow-xs">
        <button
          type="button"
          onClick={() => text && setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-xs font-medium text-meta"
        >
          {live ? <MatrixLoader variant="pulse" /> : <span aria-hidden>✓</span>}
          <span>{live ? 'Thinking…' : 'Thought'}</span>
          {text && <span className="ml-auto text-[11px]">{open || live ? 'Hide' : 'Show'}</span>}
        </button>
        {text && (open || live) && (
          <div className="mt-2 select-text">
            <ReasoningStream
              maxHeight={live ? 72 : 240}
              className="text-xs font-mono leading-relaxed text-fg-2"
            >
              {text}
            </ReasoningStream>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({
  msg,
  onRollback,
}: {
  msg: ChatMessage;
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
        <CollapsibleText
          text={msg.content}
          title="Your message"
          className="rounded-md rounded-br-sm bg-accent px-4 py-2.5 text-[13px] leading-relaxed text-accent-on"
          actionTone="justify-end"
        />
      </div>
    );
  }

  if (msg.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <CollapsibleText
          text={msg.content}
          title="Agent message"
          className="rounded-md rounded-bl-sm border border-line-soft bg-raised px-4 py-2.5 text-[13px] leading-relaxed text-fg"
        />
      </div>
    );
  }

  if (msg.eventType === 'waiting_approval') {
    return (
      <div className="flex justify-center">
        <div className="inline-flex max-w-[90%] items-start gap-2 rounded-sm border border-warn/25 bg-warn-soft px-4 py-2 text-[13px] text-fg">
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span className="select-text whitespace-pre-wrap break-words">{msg.content}</span>
        </div>
      </div>
    );
  }

  if (msg.eventType === 'error') {
    return (
      <div className="flex justify-center">
        <div className="inline-flex max-w-[90%] items-center gap-2 rounded-sm border border-danger/25 bg-danger/10 px-4 py-2 text-[13px] text-danger">
          <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="select-text whitespace-pre-wrap break-words">{msg.content}</span>
        </div>
      </div>
    );
  }

  if (msg.eventType === 'thinking') return <ThinkingBlock msg={msg} />;

  if (msg.eventType === 'command_exec') {
    return (
      <DetailRow
        summary={msg.content}
        detail={msg.detail}
        mono
        tone="border-line-soft bg-canvas text-fg-2"
      />
    );
  }

  if (msg.detail) {
    return <DetailRow summary={msg.content} detail={msg.detail} />;
  }

  return (
    <div className="flex justify-center">
      <span className="inline-block max-w-[90%] select-text whitespace-pre-wrap break-words rounded-full bg-raised px-3 py-1 text-center text-xs text-muted">
        {msg.content}
      </span>
    </div>
  );
}
