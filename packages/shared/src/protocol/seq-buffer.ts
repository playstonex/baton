/**
 * Per-session sequence buffer for resume-after-reconnect.
 *
 * Borrows Remodex's design: the daemon stamps every streamed message with a
 * monotonic per-session `seq`. On reconnect, a client that advertised the
 * `sessionResume` capability sends `resume_session { lastSeq }` instead of a
 * full re-attach; the daemon replays everything after `lastSeq` from this
 * bounded ring buffer. The relay stays stateless — only the daemon buffers.
 *
 * Bound: a hard cap on message count AND total byte size, whichever trips first.
 * When evicting, the oldest entries fall off; a client whose `lastSeq` is now
 * behind the floor gets `gap=true` on its resume_reply and must full re-attach.
 */

import type { TerminalOutputMessage, ParsedEventMessage, StatusUpdateMessage } from './index.js';

/**
 * The subset of DaemonMessage variants that carry a per-session `seq` and are
 * eligible for resume replay. Keeping this narrow (vs all of DaemonMessage)
 * makes the seq mutation type-safe — only these three message types declare
 * an optional `seq` field on the wire.
 */
export type SequencedMessage =
  | (TerminalOutputMessage & { seq: number })
  | (ParsedEventMessage & { seq: number })
  | (StatusUpdateMessage & { seq: number });

interface BufferedMessage {
  seq: number;
  msg: SequencedMessage;
  /** Pre-serialized byte length, for the size cap. */
  bytes: number;
}

export interface SeqBufferOptions {
  /** Max number of buffered messages per session. Default 500. */
  maxMessages?: number;
  /** Max total bytes of serialized messages per session. Default 2MB. */
  maxBytes?: number;
}

export interface ReplayResult {
  /** Messages to replay, in seq order (oldest first). */
  messages: SequencedMessage[];
  /** First seq in the replay (inclusive). Equals lastSeq+1 if no gap. */
  fromSeq: number;
  /** Last seq in the replay (inclusive). */
  toSeq: number;
  /** Highest seq ever assigned for this session. */
  currentSeq: number;
  /** True when lastSeq is older than the buffer's oldest retained seq. */
  gap: boolean;
}

export class SeqBuffer {
  private nextSeq = 1;
  private totalBytes = 0;
  private readonly maxMessages: number;
  private readonly maxBytes: number;
  private readonly buffer: BufferedMessage[] = [];

  constructor(opts: SeqBufferOptions = {}) {
    this.maxMessages = opts.maxMessages ?? 500;
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  }

  /** Current highest assigned seq (0 before any push). */
  get currentSeq(): number {
    return this.nextSeq - 1;
  }

  /** Lowest retained seq (0 if buffer empty). */
  get floorSeq(): number {
    return this.buffer.length > 0 ? this.buffer[0].seq : 0;
  }

  /**
   * Assign the next seq, attach it to the message (mutates `msg.seq`), and
   * buffer it. Returns the assigned seq number.
   *
   * Note: the message type is narrowed to the three seq-carrying variants.
   * Callers constructing a fresh message object can pass it directly; the
   * mutation adds the `seq` field making it a valid SequencedMessage.
   */
  push(msg: TerminalOutputMessage | ParsedEventMessage | StatusUpdateMessage): number {
    const seq = this.nextSeq++;
    (msg as SequencedMessage).seq = seq;
    const bytes = JSON.stringify(msg).length;
    this.buffer.push({ seq, msg: msg as SequencedMessage, bytes });
    this.totalBytes += bytes;
    this.evict();
    return seq;
  }

  /** Evict oldest entries until under both caps. */
  private evict(): void {
    while (this.buffer.length > this.maxMessages || this.totalBytes > this.maxBytes) {
      const dropped = this.buffer.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.bytes;
    }
  }

  /**
   * Collect all retained messages with seq > lastSeq, in order.
   * Returns a ReplayResult describing the gap state for the resume_reply.
   */
  replay(lastSeq: number): ReplayResult {
    const messages = this.buffer.filter((b) => b.seq > lastSeq).map((b) => b.msg);
    const fromSeq = messages.length > 0 ? (messages[0].seq ?? 0) : this.currentSeq;
    const toSeq = messages.length > 0 ? (messages[messages.length - 1].seq ?? 0) : this.currentSeq;
    // Gap: client asked for everything after lastSeq, but we've already
    // evicted messages between floorSeq and lastSeq.
    // Also a gap when lastSeq is AHEAD of anything we ever assigned: the seq
    // space was reset (daemon restart, or the session's buffer was recreated),
    // so the client's history belongs to a previous epoch and it must re-attach
    // for a full history replay rather than silently resuming into nothing.
    const evicted = lastSeq < this.floorSeq - 1 && this.buffer.length > 0;
    const reset = lastSeq > this.currentSeq;
    const gap = evicted || reset;
    return {
      messages,
      fromSeq,
      toSeq,
      currentSeq: this.currentSeq,
      gap,
    };
  }

  /** Drop all buffered state (session stopped/destroyed). */
  clear(): void {
    this.buffer.length = 0;
    this.totalBytes = 0;
  }
}
