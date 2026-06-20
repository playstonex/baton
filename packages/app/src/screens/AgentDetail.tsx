import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button } from '@heroui/react';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../stores/events.js';
import { wsService } from '../services/websocket.js';
import { Card, EmptyState, StatusBadge, MetricCard, Breadcrumbs } from '../lib/ui.js';
import {
  IconTerminal,
  IconGitBranch,
  IconFile,
  IconSpinner,
} from '../lib/icons.js';

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

    const unsubEventHistory = wsService.on('event_history', (msg) => {
      if (msg.type === 'event_history' && msg.sessionId === sessionId) {
        for (const event of msg.events) {
          addEvent(event);
        }
      }
    });

    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        addEvent({ type: 'raw_output', content: msg.data, timestamp: Date.now() });
      }
    });

    const unsubHistory = wsService.on('history_replay', (msg) => {
      if (msg.type === 'history_replay' && msg.sessionId === sessionId) {
        addEvent({ type: 'raw_output', content: msg.output, timestamp: Date.now() });
      }
    });

    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    return () => {
      unsubEvent();
      unsubEventHistory();
      unsubOutput();
      unsubHistory();
    };
  }, [sessionId, addEvent, clearEvents]);

  const statusEvents = events.filter(
    (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
  );

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="flex items-center justify-between">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', onClick: () => navigate('/') },
            { label: sessionId?.slice(0, 8) ?? '' },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onPress={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
          <Button variant="outline" size="sm" onPress={() => navigate(`/git/${sessionId}`)}>
            <IconGitBranch className="mr-1.5 h-3.5 w-3.5" />
            Git
          </Button>
          <Button variant="outline" size="sm" onPress={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <MetricCard label="File Changes" value={fileChanges.length} />
        <MetricCard label="Tool Uses" value={toolUses.length} />
        <MetricCard label="Total Events" value={events.length} />
      </div>

      {fileChanges.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">File Changes</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {fileChanges.length}
            </span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          </div>
          <div className="space-y-1.5">
            {fileChanges.map((e, i) =>
              e.type === 'file_change' ? (
                <FileChangeRow key={i} path={e.path} changeType={e.changeType} />
              ) : null,
            )}
          </div>
        </div>
      )}

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Event Timeline</h3>
          <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {[...statusEvents, ...toolUses].length}
          </span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>
        <Card className="max-h-[500px] overflow-auto p-0">
          {statusEvents.length === 0 && toolUses.length === 0 ? (
            <EmptyState
              icon={<IconSpinner className="h-6 w-6 text-gray-400" />}
              title="Waiting for events..."
            />
          ) : (
            <div className="relative">
              <div className="pointer-events-none absolute left-[62px] top-0 bottom-0 w-px bg-gray-100 dark:bg-gray-800" />
              {[...statusEvents, ...toolUses]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((event, i) => <EventRow key={i} event={event} />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FileChangeRow({ path, changeType }: { path: string; changeType: string }) {
  const colorMap: Record<string, string> = {
    create: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-950',
    modify: 'text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-950',
    delete: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950',
  };
  const iconMap: Record<string, string> = {
    create: '+',
    modify: '~',
    delete: '−',
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-5 py-3.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800">
      <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${colorMap[changeType] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
        {iconMap[changeType] ?? '~'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-gray-700 dark:text-gray-300">{path}</span>
      <StatusBadge status={changeType === 'create' ? 'completed' : changeType === 'delete' ? 'error' : 'running'} dot={false} />
    </div>
  );
}

function EventRow({ event }: { event: ParsedEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const dotColors: Record<string, string> = {
    status_change: 'bg-primary-500',
    thinking: 'bg-warning-500',
    tool_use: 'bg-purple-500',
    file_change: 'bg-primary-400',
    command_exec: 'bg-warning-400',
    error: 'bg-danger-500',
    raw_output: 'bg-gray-400',
  };

  const bgColors: Record<string, string> = {
    status_change: 'border-l-primary-400',
    thinking: 'border-l-warning-400',
    tool_use: 'border-l-purple-400',
    error: 'border-l-danger-400',
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
    <div className={`flex items-center gap-3 border-l-2 px-5 py-3 transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/30 ${bgColors[event.type] ?? 'border-l-transparent'}`}>
      <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-gray-400">{time}</span>
      <span className={`relative z-10 inline-flex h-2 w-2 rounded-full ${dotColors[event.type] ?? 'bg-gray-400'}`} />
      <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">{description}</span>
    </div>
  );
}
