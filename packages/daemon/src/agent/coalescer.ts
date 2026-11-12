import type { ParsedEvent } from '@baton/shared';

export const DEFAULT_COALESCE_WINDOW_MS = 60;

export interface CoalescerOptions {
  windowMs?: number;
  onFlush: (event: ParsedEvent) => void;
}

/**
 * AgentStreamCoalescer merges high-frequency micro-chunks of raw_output or thinking
 * within a 60ms window while preserving 0ms immediate delivery for the leading chunk.
 *
 * Any non-coalescable event (tool_use, permission_request, status_change, etc.)
 * immediately flushes any buffered text first to maintain strict chronological ordering.
 */
export class AgentStreamCoalescer {
  private readonly windowMs: number;
  private readonly onFlush: (event: ParsedEvent) => void;

  private buffer = '';
  private bufferType: 'raw_output' | 'thinking' | null = null;
  private bufferTimestamp = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private leadingSent = false;

  constructor(options: CoalescerOptions) {
    this.windowMs = options.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    this.onFlush = options.onFlush;
  }

  push(event: ParsedEvent): void {
    if (event.type === 'raw_output' || event.type === 'thinking') {
      // If we already had buffered text of a DIFFERENT type, flush it first
      if (this.bufferType && this.bufferType !== event.type) {
        this.flush();
      }

      this.bufferType = event.type;
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
      this.buffer += event.content;
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

    if (this.buffer.length > 0 && this.bufferType) {
      const flushedEvent: ParsedEvent = {
        type: this.bufferType,
        content: this.buffer,
        timestamp: this.bufferTimestamp,
      };
      this.buffer = '';
      this.bufferType = null;
      this.leadingSent = false;
      this.onFlush(flushedEvent);
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
