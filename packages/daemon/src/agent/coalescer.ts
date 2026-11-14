import type { ParsedEvent } from '@baton/shared';

export const DEFAULT_COALESCE_WINDOW_MS = 60;

export interface CoalescerOptions {
  windowMs?: number;
  onFlush: (event: ParsedEvent) => void;
}

/** Event types whose content streams in micro-chunks and can be merged. */
type CoalescableType = 'raw_output' | 'thinking' | 'chat_message';

/**
 * Assistant prose only, with the content narrowed out of the union. A user or
 * system chat_message is a discrete utterance and must never be merged into a
 * neighbour.
 */
function coalescable(event: ParsedEvent): { type: CoalescableType; content: string } | null {
  if (event.type === 'raw_output' || event.type === 'thinking') {
    return { type: event.type, content: event.content };
  }
  if (event.type === 'chat_message' && event.role === 'assistant') {
    return { type: 'chat_message', content: event.content };
  }
  return null;
}

/**
 * AgentStreamCoalescer merges high-frequency micro-chunks of assistant text
 * (raw_output, thinking, chat_message) within a 60ms window while preserving
 * 0ms immediate delivery for the leading chunk.
 *
 * chat_message belongs in this set because streaming providers size their
 * chunks arbitrarily: an ACP agent_message_chunk often carries one or two
 * characters. Leaving it out also defeated the coalescer for the other types,
 * since an interleaved chat_message took the "any other event" path and
 * flushed the buffer on every chunk.
 *
 * Any non-coalescable event (tool_use, permission_request, status_change, etc.)
 * immediately flushes any buffered text first to maintain strict chronological ordering.
 */
export class AgentStreamCoalescer {
  private readonly windowMs: number;
  private readonly onFlush: (event: ParsedEvent) => void;

  private buffer = '';
  private bufferType: CoalescableType | null = null;
  private bufferTimestamp = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private leadingSent = false;

  constructor(options: CoalescerOptions) {
    this.windowMs = options.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    this.onFlush = options.onFlush;
  }

  push(event: ParsedEvent): void {
    const text = coalescable(event);
    if (text) {
      // If we already had buffered text of a DIFFERENT type, flush it first
      if (this.bufferType && this.bufferType !== text.type) {
        this.flush();
      }

      this.bufferType = text.type;
      this.bufferTimestamp = event.timestamp || Date.now();

      // Leading edge: if no timer is active and leading has not been sent,
      // emit the first chunk immediately for 0ms latency.
      if (!this.leadingSent) {
        this.leadingSent = true;
        this.onFlush(event);
        this.scheduleFlush();
        return;
      }

      // Trailing edge: buffer subsequent chunks within the window
      this.buffer += text.content;
      if (!this.timer) {
        this.scheduleFlush();
      }
      return;
    }

    // Any other event type: flush pending text first, then emit
    this.flush();
    this.onFlush(event);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const type = this.bufferType;
    if (this.buffer.length > 0 && type) {
      const content = this.buffer;
      const timestamp = this.bufferTimestamp;
      this.buffer = '';
      this.bufferType = null;
      this.leadingSent = false;
      this.onFlush(
        type === 'chat_message'
          ? { type, role: 'assistant', content, timestamp }
          : { type, content, timestamp },
      );
    } else {
      this.buffer = '';
      this.bufferType = null;
      this.leadingSent = false;
    }
  }

  private scheduleFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.windowMs);
  }

  destroy(): void {
    this.flush();
  }
}
