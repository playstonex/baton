import type { ParsedEvent } from '@baton/shared';

interface CompactionResult {
  originalEventCount: number;
  compactedEventCount: number;
  summary: string;
  savedBytes: number;
}

export class ContextCompressor {
  private sessionEvents = new Map<string, ParsedEvent[]>();
  private compactionThreshold: number;

  constructor(threshold = 500) {
    this.compactionThreshold = threshold;
  }

  addEvent(sessionId: string, event: ParsedEvent): void {
    const events = this.sessionEvents.get(sessionId) ?? [];
    events.push(event);
    this.sessionEvents.set(sessionId, events);
  }

  needsCompaction(sessionId: string): boolean {
    return (this.sessionEvents.get(sessionId)?.length ?? 0) >= this.compactionThreshold;
  }

  compact(sessionId: string): CompactionResult | null {
    const events = this.sessionEvents.get(sessionId);
    if (!events || events.length < this.compactionThreshold) return null;

    const originalCount = events.length;
    const keepCount = Math.floor(this.compactionThreshold * 0.3);

    const toolCalls: Record<string, { count: number; successCount: number; totalDuration: number }> = {};
    let errorCount = 0;
    let turnCount = 0;

    const toCompress = events.slice(0, events.length - keepCount);

    for (const event of toCompress) {
      switch (event.type) {
        case 'tool_use':
          if (!toolCalls[event.tool]) toolCalls[event.tool] = { count: 0, successCount: 0, totalDuration: 0 };
          toolCalls[event.tool].count++;
          break;
        case 'tool_call_end':
          break;
        case 'error':
          errorCount++;
          break;
        case 'turn_boundary':
          if (event.direction === 'start') turnCount++;
          break;
      }
    }

    const toolSummaries = Object.entries(toolCalls)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([tool, stats]) => `${tool}(${stats.count})`)
      .join(', ');

    const summary = `[Compact] ${turnCount} turns, ${toCompress.length} events compressed. Tools: ${toolSummaries || 'none'}. Errors: ${errorCount}.`;

    const compactedEvent: ParsedEvent = {
      type: 'raw_output',
      content: summary,
      timestamp: toCompress[toCompress.length - 1]?.timestamp ?? Date.now(),
    };

    const kept = events.slice(-keepCount);
    this.sessionEvents.set(sessionId, [compactedEvent, ...kept]);

    const originalBytes = JSON.stringify(toCompress).length;

    return {
      originalEventCount: originalCount,
      compactedEventCount: kept.length + 1,
      summary,
      savedBytes: originalBytes - JSON.stringify(compactedEvent).length,
    };
  }

  getEvents(sessionId: string): ParsedEvent[] {
    return this.sessionEvents.get(sessionId) ?? [];
  }

  clear(sessionId: string): void {
    this.sessionEvents.delete(sessionId);
  }
}
