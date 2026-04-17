import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import type { ParsedEvent } from '@flowwhips/shared';
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

    // Ensure we're attached
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          Agent Detail
          <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 8, fontSize: 14 }}>
            {sessionId?.slice(0, 8)}
          </span>
        </h2>
        <button onClick={() => navigate(`/terminal/${sessionId}`)} style={{ fontSize: 13, padding: '4px 14px', cursor: 'pointer' }}>
          Terminal
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="File Changes" value={fileChanges.length} color="#3b82f6" />
        <StatCard label="Tool Uses" value={toolUses.length} color="#8b5cf6" />
        <StatCard label="Total Events" value={events.length} color="#22c55e" />
      </div>

      {/* File Changes */}
      {fileChanges.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>File Changes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fileChanges.map((e, i) =>
              e.type === 'file_change' ? (
                <FileChangeRow key={i} path={e.path} changeType={e.changeType} />
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Event Timeline */}
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Event Timeline</h3>
      <div
        style={{
          maxHeight: 500,
          overflow: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 8,
          background: '#fafafa',
        }}
      >
        {statusEvents.length === 0 && toolUses.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
            Waiting for events...
          </div>
        ) : (
          [...statusEvents, ...toolUses]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((event, i) => <EventRow key={i} event={event} />)
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: 16,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function FileChangeRow({ path, changeType }: { path: string; changeType: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    create: { bg: '#dcfce7', text: '#166534' },
    modify: { bg: '#dbeafe', text: '#1e40af' },
    delete: { bg: '#fef2f2', text: '#991b1b' },
  };
  const style = colors[changeType] ?? colors.modify;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: '#fff',
        borderRadius: 4,
        border: '1px solid #f3f4f6',
      }}
    >
      <span
        style={{
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 3,
          background: style.bg,
          color: style.text,
          fontWeight: 500,
          textTransform: 'uppercase',
        }}
      >
        {changeType}
      </span>
      <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{path}</span>
    </div>
  );
}

function EventRow({ event }: { event: ParsedEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString();

  const icon: Record<string, string> = {
    status_change: '●',
    thinking: '💬',
    tool_use: '🔧',
    file_change: '📄',
    command_exec: '⚡',
    error: '❌',
    raw_output: '📝',
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        fontSize: 12,
        borderBottom: '1px solid #f3f4f6',
      }}
    >
      <span style={{ fontSize: 10, color: '#9ca3af', width: 60, flexShrink: 0 }}>{time}</span>
      <span>{icon[event.type] ?? '●'}</span>
      <span style={{ color: '#374151' }}>{description}</span>
    </div>
  );
}
