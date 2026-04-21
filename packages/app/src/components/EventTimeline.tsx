import type { ParsedEvent } from '@flowwhips/shared';

interface EventTimelineProps {
  events: ParsedEvent[];
  maxHeight?: number;
}

export function EventTimeline({ events, maxHeight = 400 }: EventTimelineProps) {
  const statusEvents = events.filter(
    (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
  );

  const toolEvents = events.filter((e) => e.type === 'tool_use');

  return (
    <div
      style={{
        maxHeight,
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 8,
        background: '#fafafa',
      }}
    >
      {events.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Waiting for events...</div>
      ) : (
        [...statusEvents, ...toolEvents]
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((event, idx) => <EventRow key={idx} event={event} />)
      )}
    </div>
  );
}

function EventRow({ event }: { event: ParsedEvent }) {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'status_change':
        return { bg: '#dbeafe', text: '#1e40af', dot: '#3b82f6' };
      case 'tool_use':
        return { bg: '#ede9fe', text: '#5b21b6', dot: '#8b5cf6' };
      case 'thinking':
        return { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' };
      case 'error':
        return { bg: '#fef2f2', text: '#991b1b', dot: '#ef4444' };
      case 'raw_output':
        return { bg: '#f3f4f6', text: '#374151', dot: '#6b7280' };
      default:
        return { bg: '#f3f4f6', text: '#374151', dot: '#9ca3af' };
    }
  };

  const color = getTypeColor(event.type);

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
        return <span style={{ color: '#ef4444' }}>{event.message}</span>;
      case 'raw_output':
        return <span style={{ color: '#6b7280' }}>{event.content?.slice(0, 50)}</span>;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 4,
        background: color.bg,
        marginBottom: 4,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color.dot,
          marginTop: 4,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 2,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 500, color: color.text, textTransform: 'uppercase' }}>
            {event.type}
          </span>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>{formatTime(event.timestamp)}</span>
        </div>
        <div style={{ fontSize: 12, color: color.text }}>{renderContent()}</div>
      </div>
    </div>
  );
}

export function TimelineItem({ event }: { event: ParsedEvent }) {
  return <EventRow event={event} />;