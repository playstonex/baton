import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Card, CardContent, Chip } from '@heroui/react';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../stores/events.js';
import { wsService } from '../services/websocket.js';

export function AgentDetailScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { events, fileChanges, toolUses, addEvent, clearEvents } = useEventsStore();

  useEffect(() => {
    if (!sessionId) return;

    clearEvents();

    const unsubEvent = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        addEvent(msg.event);
      }
    });

    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        addEvent({ type: 'raw_output', content: msg.data, timestamp: Date.now() });
      }
    });

    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    return () => {
      unsubEvent();
      unsubOutput();
    };
  }, [sessionId, addEvent, clearEvents]);

  const statusEvents = events.filter(
    (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-surface-900 dark:text-white">
          Agent Detail
          <span className="ml-2 text-sm font-normal text-surface-400">{sessionId?.slice(0, 8)}</span>
        </h2>
        <Button variant="outline" size="sm" onPress={() => navigate(`/terminal/${sessionId}`)}>
          Terminal
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="File Changes" value={fileChanges.length} color="border-t-primary-500" />
        <StatCard label="Tool Uses" value={toolUses.length} color="border-t-purple-500" />
        <StatCard label="Total Events" value={events.length} color="border-t-success-500" />
      </div>

      {fileChanges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">File Changes</h3>
          <div className="space-y-1">
            {fileChanges.map((e, i) =>
              e.type === 'file_change' ? (
                <FileChangeRow key={i} path={e.path} changeType={e.changeType} />
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Event Timeline</h3>
        <Card>
          <CardContent className="max-h-[500px] overflow-auto p-2">
            {statusEvents.length === 0 && toolUses.length === 0 ? (
              <div className="py-8 text-center text-sm text-surface-400">Waiting for events...</div>
            ) : (
              [...statusEvents, ...toolUses]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((event, i) => <EventRow key={i} event={event} />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className={`border-t-2 ${color}`}>
      <CardContent className="p-4 text-center">
        <div className="text-2xl font-bold text-surface-900 dark:text-white">{value}</div>
        <div className="mt-0.5 text-xs text-surface-500">{label}</div>
      </CardContent>
    </Card>
  );
}

function FileChangeRow({ path, changeType }: { path: string; changeType: string }) {
  const colorMap: Record<string, 'success' | 'accent' | 'danger'> = {
    create: 'success',
    modify: 'accent',
    delete: 'danger',
  };

  return (
    <Card>
      <CardContent className="flex items-center gap-2 px-3 py-1.5">
        <Chip size="sm" variant="soft" color={colorMap[changeType] ?? 'accent'}>
          {changeType}
        </Chip>
        <span className="truncate font-mono text-[13px] text-surface-700 dark:text-surface-300">{path}</span>
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: ParsedEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString();

  const dotColors: Record<string, string> = {
    status_change: 'bg-primary-500',
    thinking: 'bg-warning-500',
    tool_use: 'bg-purple-500',
    file_change: 'bg-primary-400',
    command_exec: 'bg-warning-400',
    error: 'bg-danger-500',
    raw_output: 'bg-surface-400',
  };

  const description = (() => {
    switch (event.type) {
      case 'status_change':
        return `Status → ${event.status}`;
      case 'thinking':
        return 'Thinking...';
      case 'tool_use':
        return `${event.tool}${event.args?.filePath ? ` → ${event.args.filePath}` : ''}`;
      case 'file_change':
        return `${event.changeType} ${event.path}`;
      case 'command_exec':
        return `$ ${event.command}`;
      case 'error':
        return event.message.slice(0, 80);
      default:
        return '';
    }
  })();

  return (
    <div className="flex items-center gap-2 border-b border-surface-100 px-2 py-1 text-xs last:border-0 dark:border-surface-700">
      <span className="w-14 shrink-0 text-surface-400">{time}</span>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColors[event.type] ?? 'bg-surface-400'}`} />
      <span className="text-surface-700 dark:text-surface-300">{description}</span>
    </div>
  );
}
