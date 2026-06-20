import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, Chip, Button } from '@heroui/react';
import type { ParsedEvent } from '@baton/shared';
import { wsService } from '../services/websocket.js';

interface EventTimelineProps {
  events: ParsedEvent[];
  maxHeight?: number;
  sessionId?: string;
}

const TYPE_COLORS: Record<string, 'accent' | 'default' | 'warning' | 'danger' | 'success'> = {
  status_change: 'accent',
  tool_use: 'default',
  tool_call_start: 'accent',
  tool_call_end: 'success',
  permission_request: 'warning',
  permission_response: 'default',
  turn_boundary: 'accent',
  thinking: 'warning',
  error: 'danger',
  raw_output: 'default',
};

const TYPE_DOT: Record<string, string> = {
  status_change: 'bg-primary-500',
  tool_use: 'bg-purple-500',
  tool_call_start: 'bg-blue-500',
  tool_call_end: 'bg-success-500',
  permission_request: 'bg-warning-500',
  permission_response: 'bg-gray-400',
  turn_boundary: 'bg-primary-300',
  thinking: 'bg-warning-500',
  error: 'bg-danger-500',
  raw_output: 'bg-gray-400',
};

export function EventTimeline({ events, maxHeight = 400, sessionId }: EventTimelineProps) {
  const sorted = useMemo(() => {
    return [...events].sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  return (
    <Card style={{ maxHeight }}>
      <CardContent className="overflow-auto p-4">
        {events.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">Waiting for events...</div>
        ) : (
          sorted.map((event, idx) => (
            <TimelineEventRow
              key={`${event.type}-${event.timestamp}-${idx}`}
              event={event}
              sessionId={sessionId}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TimelineEventRow({ event, sessionId }: { event: ParsedEvent; sessionId?: string }) {
  const color = TYPE_COLORS[event.type] ?? 'default';
  const dot = TYPE_DOT[event.type] ?? 'bg-gray-400';
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
      case 'tool_call_start':
        return (
          <span>
            <strong>{event.tool}</strong>
            {event.title ? ` — ${event.title}` : ''}
            <span className="ml-2 text-[10px] text-gray-400">{event.callId}</span>
          </span>
        );
      case 'tool_call_end': {
        const duration = event.durationMs != null ? `${event.durationMs}ms` : '';
        return (
          <span className={event.success ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}>
            {event.success ? '✓' : '✗'} Tool completed
            {duration && <span className="ml-1 text-gray-400">{duration}</span>}
          </span>
        );
      }
      case 'permission_request':
        return <PermissionInline event={event} sessionId={sessionId} />;
      case 'permission_response':
        return (
          <span className={event.approved ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}>
            {event.approved ? 'Approved' : 'Denied'}
          </span>
        );
      case 'turn_boundary':
        return (
          <span className="text-gray-400">
            Turn {event.direction} <span className="text-[10px]">{event.turnId}</span>
            {event.status ? ` (${event.status})` : ''}
          </span>
        );
      case 'thinking':
        return <span>{event.content?.slice(0, 100)}</span>;
      case 'error':
        return <span className="text-danger-600 dark:text-danger-400">{event.message}</span>;
      case 'raw_output':
        return <span className="text-gray-500 dark:text-gray-400">{event.content?.slice(0, 50)}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="mb-2 flex items-start gap-3 rounded-lg px-4 py-2.5">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between">
          <Chip size="sm" variant="soft" color={color}>{event.type.replace(/_/g, ' ')}</Chip>
          <span className="text-[10px] text-gray-400">{time}</span>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">{renderContent()}</div>
      </div>
    </div>
  );
}

function PermissionInline({
  event,
  sessionId,
}: {
  event: Extract<ParsedEvent, { type: 'permission_request' }>;
  sessionId?: string;
}) {
  const [responded, setResponded] = useState(false);

  const respond = useCallback(
    (approved: boolean) => {
      if (!sessionId) return;
      wsService.send({
        type: 'control',
        action: 'permission_response',
        sessionId,
        payload: { requestId: event.requestId, approved },
      });
      setResponded(true);
    },
    [event.requestId, sessionId],
  );

  if (responded) {
    return <span className="text-gray-400">Responded</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span>
        <strong>{event.tool}</strong>: {event.description}
      </span>
      <Button size="sm" variant="primary" onPress={() => respond(true)}>
        Allow
      </Button>
      <Button size="sm" variant="danger" onPress={() => respond(false)}>
        Deny
      </Button>
    </div>
  );
}

export function PermissionDialog({
  isOpen,
  onClose,
  event,
  sessionId,
}: {
  isOpen: boolean;
  onClose: () => void;
  event: Extract<ParsedEvent, { type: 'permission_request' }> | null;
  sessionId?: string;
}) {
  const respond = useCallback(
    (approved: boolean) => {
      if (!sessionId || !event) return;
      wsService.send({
        type: 'control',
        action: 'permission_response',
        sessionId,
        payload: { requestId: event.requestId, approved },
      });
      onClose();
    },
    [event, sessionId, onClose],
  );

  if (!event) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? '' : 'pointer-events-none'}`}
    >
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Permission Request
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {event.tool}: {event.action}
            </p>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {event.description}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="danger" onPress={() => respond(false)}>
                Deny
              </Button>
              <Button size="sm" variant="primary" onPress={() => respond(true)}>
                Allow
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function TimelineItem({ event }: { event: ParsedEvent }) {
  return <TimelineEventRow event={event} sessionId={undefined} />;
}
