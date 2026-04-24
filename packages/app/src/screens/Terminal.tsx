import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Chip } from '@heroui/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsService } from '../services/websocket.js';
import '@xterm/xterm/css/xterm.css';

const XTERM_THEME = {
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
};

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
      theme: XTERM_THEME,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    termRef.current = term;
    fitRef.current = fitAddon;

    term.open(termContainerRef.current);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // fallback to canvas renderer
    }

    fitAddon.fit();

    term.onData((data) => {
      wsService.send({ type: 'terminal_input', sessionId, data });
    });

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

    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        term.write(msg.data);
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && msg.sessionId === sessionId) {
        setStatus(msg.status as string);
      }
    });

    const unsubEvents = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        if (msg.event.type === 'status_change') {
          setStatus(msg.event.status);
        }
      }
    });

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

  const statusDotColor = status === 'running' ? 'bg-success-500' : status === 'thinking' ? 'bg-primary-500 animate-pulse-dot' : status === 'stopped' ? 'bg-danger-500' : 'bg-surface-300';

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between rounded-lg border border-surface-200 bg-surface-50 px-3 py-1.5 dark:border-surface-700 dark:bg-surface-800">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDotColor}`} />
          <span className="text-[13px] font-medium text-surface-700 dark:text-surface-300">Agent</span>
          <span className="font-mono text-xs text-surface-400">{sessionId?.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="soft" color={connected ? 'success' : 'danger'}>
            {connected ? 'Connected' : 'Disconnected'}
          </Chip>
          <Button size="sm" variant="outline" onPress={() => navigate(`/agent/${sessionId}`)}>
            Events
          </Button>
          <Button size="sm" variant="danger" onPress={stopAgent}>
            Stop
          </Button>
        </div>
      </div>

      <div
        ref={termContainerRef}
        className="flex-1 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700"
      />
    </div>
  );
}
