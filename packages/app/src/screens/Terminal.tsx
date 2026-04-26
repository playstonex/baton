import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Chip } from '@heroui/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsService } from '../services/websocket.js';
import '@xterm/xterm/css/xterm.css';

const LIGHT_THEME = {
  background: '#fafaf9',
  foreground: '#1c1917',
  cursor: '#2383e2',
  selectionBackground: 'rgba(35, 131, 226, 0.2)',
  black: '#78716c',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2383e2',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#292524',
  brightBlack: '#a8a29e',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#1c1917',
};

const DARK_THEME = {
  background: '#191919',
  foreground: '#e8e8e8',
  cursor: '#4193ef',
  selectionBackground: 'rgba(65, 147, 239, 0.3)',
  black: '#383838',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e8e8e8',
  brightBlack: '#6b6b6b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#ffffff',
};

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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

    const isDark = getSystemTheme() === 'dark';
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      theme: isDark ? DARK_THEME : LIGHT_THEME,
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

    requestAnimationFrame(() => {
      if (term.element) {
        fitAddon.fit();
      }
    });

    term.onData((data) => {
      wsService.send({ type: 'terminal_input', sessionId, data });
    });

    const onResize = () => {
      if (!term.element) return;
      try {
        fitAddon.fit();
      } catch {
      }
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

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) => {
      term.options.theme = e.matches ? DARK_THEME : LIGHT_THEME;
    };
    mql.addEventListener('change', handleThemeChange);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      unsubOutput();
      unsubStatus();
      unsubEvents();
      unsubState();
      mql.removeEventListener('change', handleThemeChange);
      term.dispose();
      wsService.send({ type: 'control', action: 'detach_session', sessionId });
    };
  }, [sessionId, attachSession]);

  async function stopAgent() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'stop_agent', sessionId });
    navigate('/');
  }

  const statusDotColor = status === 'running' ? 'bg-success-500' : status === 'thinking' ? 'bg-primary-500' : status === 'stopped' ? 'bg-danger-500' : 'bg-surface-300';

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between rounded border border-surface-200 bg-white px-3 py-2 dark:border-surface-800 dark:bg-surface-900">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDotColor}`} />
          <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Agent</span>
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
        className="flex-1 overflow-hidden rounded border border-surface-200 dark:border-surface-800"
      />
    </div>
  );
}
