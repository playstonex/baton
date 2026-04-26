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
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => navigate(-1)}
          className="-ml-2 text-surface-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </Button>
        <div className="flex items-center gap-1.5 text-xs text-surface-400">
          <button type="button" onClick={() => navigate('/')} className="transition-colors hover:text-primary-500">Dashboard</button>
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" /></svg>
          <span className="font-mono text-surface-600 dark:text-surface-300">{sessionId?.slice(0, 8)}</span>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onPress={() => navigate(`/terminal/${sessionId}`)} className="gap-1.5">
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
            <path d="M4 7h2M4 10h5" />
          </svg>
          Terminal
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="File Changes" value={fileChanges.length} accent="primary" icon="📄" />
        <StatCard label="Tool Uses" value={toolUses.length} accent="purple" icon="🔧" />
        <StatCard label="Total Events" value={events.length} accent="success" icon="📊" />
      </div>

      {fileChanges.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">File Changes</h3>
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium tabular-nums text-primary-600 dark:bg-primary-950 dark:text-primary-400">
              {fileChanges.length}
            </span>
            <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
          </div>
          <div className="space-y-1">
            {fileChanges.map((e, i) =>
              e.type === 'file_change' ? (
                <FileChangeRow key={i} path={e.path} changeType={e.changeType} />
              ) : null,
            )}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Event Timeline</h3>
          <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-400">
            {[...statusEvents, ...toolUses].length}
          </span>
          <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
        </div>
        <Card className="border border-surface-200 shadow-sm dark:border-surface-700">
          <CardContent className="max-h-[500px] overflow-auto p-3">
            {statusEvents.length === 0 && toolUses.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800">
                  <span className="text-xl">⏳</span>
                </div>
                <p className="text-sm text-surface-400">Waiting for events...</p>
              </div>
            ) : (
              <div className="relative">
                <div className="pointer-events-none absolute left-[62px] top-0 bottom-0 w-px bg-surface-100 dark:bg-surface-800" />
                {[...statusEvents, ...toolUses]
                  .sort((a, b) => a.timestamp - b.timestamp)
                  .map((event, i) => <EventRow key={i} event={event} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: 'primary' | 'purple' | 'success'; icon: string }) {
  const borderClasses = {
    primary: 'border-l-primary-500',
    purple: 'border-l-purple-500',
    success: 'border-l-success-500',
  };
  const bgClasses = {
    primary: 'bg-primary-50 dark:bg-primary-950/30',
    purple: 'bg-purple-50 dark:bg-purple-950/30',
    success: 'bg-success-50 dark:bg-success-950/30',
  };

  return (
    <Card className={`overflow-hidden border border-surface-200 border-l-4 shadow-sm dark:border-surface-700 ${borderClasses[accent]}`}>
      <CardContent className={`p-5 ${bgClasses[accent]} relative`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-bold tabular-nums text-surface-900 dark:text-white">{value}</div>
            <div className="mt-1 text-xs font-medium text-surface-500">{label}</div>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${bgClasses[accent]}`}>
            {icon}
          </div>
        </div>
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
  const iconMap: Record<string, string> = {
    create: '+',
    modify: '~',
    delete: '−',
  };

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-surface-100 bg-white px-3.5 py-2.5 transition-colors hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-800/50 dark:hover:bg-surface-800">
      <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${
        changeType === 'create' ? 'bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400'
        : changeType === 'delete' ? 'bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
        : 'bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-400'
      }`}>
        {iconMap[changeType] ?? '~'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-surface-700 dark:text-surface-300">{path}</span>
      <Chip size="sm" variant="soft" color={colorMap[changeType] ?? 'accent'}>
        {changeType}
      </Chip>
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
    raw_output: 'bg-surface-400',
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
    <div className={`flex items-center gap-3 border-l-2 px-4 py-2 transition-colors hover:bg-surface-50/50 dark:hover:bg-surface-800/30 ${bgColors[event.type] ?? 'border-l-transparent'}`}>
      <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-surface-400">{time}</span>
      <span className={`relative z-10 inline-flex h-2 w-2 rounded-full ${dotColors[event.type] ?? 'bg-surface-400'}`} />
      <span className="min-w-0 flex-1 truncate text-xs text-surface-700 dark:text-surface-300">{description}</span>
    </div>
  );
}
