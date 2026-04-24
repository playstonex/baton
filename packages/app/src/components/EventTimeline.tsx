import { useMemo } from 'react';
import { Card, CardContent, Chip } from '@heroui/react';
import type { ParsedEvent } from '@baton/shared';

interface EventTimelineProps {
  events: ParsedEvent[];
  maxHeight?: number;
}

const TYPE_COLORS: Record<string, 'accent' | 'default' | 'warning' | 'danger' | 'success'> = {
  status_change: 'accent',
  tool_use: 'default',
  thinking: 'warning',
  error: 'danger',
  raw_output: 'default',
};

const TYPE_DOT: Record<string, string> = {
  status_change: 'bg-primary-500',
  tool_use: 'bg-purple-500',
  thinking: 'bg-warning-500',
  error: 'bg-danger-500',
  raw_output: 'bg-surface-400',
};

export function EventTimeline({ events, maxHeight = 400 }: EventTimelineProps) {
  const sorted = useMemo(() => {
    const statusEvents = events.filter(
      (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
    );
    const toolEvents = events.filter((e) => e.type === 'tool_use');
    return [...statusEvents, ...toolEvents].sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  return (
    <Card style={{ maxHeight }}>
      <CardContent className="overflow-auto p-2">
        {events.length === 0 ? (
          <div className="py-8 text-center text-sm text-surface-400">Waiting for events...</div>
        ) : (
          sorted.map((event, idx) => <TimelineEventRow key={`${event.type}-${event.timestamp}-${idx}`} event={event} />)
        )}
      </CardContent>
    </Card>
  );
}

function TimelineEventRow({ event }: { event: ParsedEvent }) {
  const color = TYPE_COLORS[event.type] ?? 'default';
  const dot = TYPE_DOT[event.type] ?? 'bg-surface-400';
  const time = new Date(event.timestamp).toLocaleTimeString();

  const renderContent = () => {
    switch (event.type) {
      case 'status_change':
        return (
          <span>
            Status: <strong>{event.status}</strong>
          </span>
        );
      case 'tool_use':
        return (
          <span>
            Tool <strong>{event.tool}</strong>
          </span>
        );
      case 'thinking':
        return <span>{event.content?.slice(0, 100)}</span>;
      case 'error':
        return <span className="text-danger-600 dark:text-danger-400">{event.message}</span>;
      case 'raw_output':
        return <span className="text-surface-500 dark:text-surface-400">{event.content?.slice(0, 50)}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="mb-1 flex items-start gap-2 rounded-lg px-2 py-1.5">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <Chip size="sm" variant="soft" color={color}>{event.type}</Chip>
          <span className="text-[10px] text-surface-400">{time}</span>
        </div>
        <div className="text-xs text-surface-700 dark:text-surface-300">{renderContent()}</div>
      </div>
    </div>
  );
}

export function TimelineItem({ event }: { event: ParsedEvent }) {
  return <TimelineEventRow event={event} />;
}
