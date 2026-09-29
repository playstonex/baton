import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../stores/events.js';
import { wsService } from '../services/websocket.js';
import { Card, EmptyState, StatusBadge, MetricCard, Breadcrumbs, Button } from '../lib/ui.js';
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

    wsService.attachOrResume(sessionId);

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
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', onClick: () => navigate('/') },
            { label: sessionId?.slice(0, 8) ?? '' },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/git/${sessionId}`)}>
            <IconGitBranch className="mr-1.5 h-3.5 w-3.5" />
            Git
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="File changes" value={fileChanges.length} />
        <MetricCard label="Tool uses" value={toolUses.length} />
        <MetricCard label="Total events" value={events.length} />
      </div>

      {fileChanges.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-[13px] font-semibold text-fg">File changes</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
              {fileChanges.length}
            </span>
            <div className="h-px flex-1 bg-line-soft" />
          </div>
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {fileChanges.map((e, i) =>
              e.type === 'file_change' ? (
                <FileChangeRow key={i} path={e.path} changeType={e.changeType} />
              ) : null,
            )}
          </Card>
        </div>
      )}

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-fg">Event timeline</h3>
          <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
            {[...statusEvents, ...toolUses].length}
          </span>
          <div className="h-px flex-1 bg-line-soft" />
        </div>
        <Card className="max-h-[500px] overflow-auto p-0" padding={false}>
          {statusEvents.length === 0 && toolUses.length === 0 ? (
            <EmptyState
              icon={<IconSpinner className="h-5 w-5" />}
              title="Waiting for events…"
            />
          ) : (
            <div className="relative">
              <div className="pointer-events-none absolute bottom-0 left-[74px] top-0 w-px bg-line-soft" />
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
    create: 'bg-success-soft text-success',
    modify: 'bg-accent-soft text-accent-hover',
    delete: 'bg-danger-soft text-danger',
  };
  const iconMap: Record<string, string> = {
    create: '+',
    modify: '~',
    delete: '−',
  };

  return (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-raised/50">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-semibold ${colorMap[changeType] ?? 'bg-raised text-muted'}`}>
        {iconMap[changeType] ?? '~'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-2">{path}</span>
      <StatusBadge status={changeType === 'create' ? 'completed' : changeType === 'delete' ? 'error' : 'running'} dot={false} />
    </div>
  );
}

function EventRow({ event }: { event: ParsedEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const dotColors: Record<string, string> = {
    status_change: 'bg-accent-hover',
    thinking: 'bg-warn',
    tool_use: 'bg-accent',
    file_change: 'bg-accent-hover/60',
    command_exec: 'bg-warn/60',
    error: 'bg-danger',
    raw_output: 'bg-meta',
  };

  const description = (() => {
    switch (event.type) {
      case 'status_change':
        return `Status → ${event.status}`;
      case 'thinking':
        return 'Thinking…';
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
    <div className="flex items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-raised/50">
      <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-meta">{time}</span>
      <span className={`relative z-10 inline-flex h-2 w-2 shrink-0 rounded-full ${dotColors[event.type] ?? 'bg-meta'}`} />
      <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{description}</span>
    </div>
  );
}
