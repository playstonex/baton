import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsService } from '../services/websocket.js';
import '@xterm/xterm/css/xterm.css';

export function TerminalScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>('unknown');

  const attachSession = useCallback(() => {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'attach_session', sessionId });
  }, [sessionId]);

  useEffect(() => {
    if (!termContainerRef.current || !sessionId) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    termRef.current = term;
    fitRef.current = fitAddon;

    term.open(termContainerRef.current);

    // Try WebGL renderer
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Fall back to canvas renderer
    }

    fitAddon.fit();

    // Handle terminal input
    term.onData((data) => {
      wsService.send({ type: 'terminal_input', sessionId, data });
    });

    // Handle resize
    const onResize = () => {
      fitAddon.fit();
      if (term.cols && term.rows) {
        wsService.send({
          type: 'control',
          action: 'resize',
          sessionId,
          payload: { cols: term.cols, rows: term.rows },
        });
      }
    };

    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(termContainerRef.current);

    // Listen for terminal output
    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        term.write(msg.data);
      }
    });

    // Listen for status updates
    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && msg.sessionId === sessionId) {
        setStatus(msg.status as string);
      }
    });

    // Listen for parsed events (for status bar)
    const unsubEvents = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        if (msg.event.type === 'status_change') {
          setStatus(msg.event.status);
        }
      }
    });

    // Connect and attach
    const unsubState = wsService.on('_state', () => {
      setConnected(wsService.connected);
      if (wsService.connected) attachSession();
    });

    setConnected(wsService.connected);
    if (wsService.connected) {
      attachSession();
    } else {
      wsService.connect();
    }

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      unsubOutput();
      unsubStatus();
      unsubEvents();
      unsubState();
      term.dispose();
      wsService.send({ type: 'control', action: 'detach_session', sessionId });
    };
  }, [sessionId, attachSession]);

  async function stopAgent() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'stop_agent', sessionId });
    navigate('/');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 8px',
          borderRadius: 6,
          background: '#f8f9fa',
          border: '1px solid #e5e7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot status={status} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Claude Code</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {sessionId?.slice(0, 8)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: connected ? '#dcfce7' : '#fef2f2',
              color: connected ? '#166534' : '#991b1b',
            }}
          >
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <button
            onClick={() => navigate(`/agent/${sessionId}`)}
            style={{ fontSize: 12, padding: '2px 10px', cursor: 'pointer' }}
          >
            Events
          </button>
          <button
            onClick={stopAgent}
            style={{
              fontSize: 12,
              padding: '2px 10px',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={termContainerRef}
        style={{
          flex: 1,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
        }}
      />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: '#22c55e',
    thinking: '#3b82f6',
    executing: '#8b5cf6',
    waiting_input: '#f59e0b',
    idle: '#6b7280',
    stopped: '#ef4444',
    starting: '#94a3b8',
    unknown: '#94a3b8',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status] ?? '#94a3b8',
        animation: status === 'thinking' || status === 'executing' ? 'pulse 1.5s infinite' : 'none',
      }}
    />
  );
}
