import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsService } from '../services/websocket.js';
import { StatusBadge, StatusDot, Button } from '../lib/ui.js';
import { IconFile, IconGitBranch, IconActivity, IconStop } from '../lib/icons.js';
import '@xterm/xterm/css/xterm.css';

// Terminal ANSI colors — Linear palette (achromatic + indigo-violet accent).
interface XTermTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const LIGHT_THEME: XTermTheme = {
  background: '#ffffff',
  foreground: '#1b1d22',
  cursor: '#5e6ad2',
  selectionBackground: 'rgba(94, 106, 210, 0.22)',
  black: '#6f747e',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#4752c4',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#42454c',
  brightBlack: '#9095a0',
  brightRed: '#eb4d55',
  brightGreen: '#3fb950',
  brightYellow: '#d9a62e',
  brightBlue: '#7170ff',
  brightMagenta: '#ab7df8',
  brightCyan: '#00ac96',
  brightWhite: '#1b1d22',
};

const DARK_THEME: XTermTheme = {
  background: '#0f1011',
  foreground: '#e8eaed',
  cursor: '#7170ff',
  selectionBackground: 'rgba(94, 106, 210, 0.35)',
  black: '#2e3033',
  red: '#eb4d55',
  green: '#3fb950',
  yellow: '#d9a62e',
  blue: '#7170ff',
  magenta: '#c472fb',
  cyan: '#39c5cf',
  white: '#d0d6e0',
  brightBlack: '#62666d',
  brightRed: '#ff6b70',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#828fff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#39c5cf',
  brightWhite: '#f7f8f8',
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
  const [sessionOwner, setSessionOwner] = useState<'local' | 'remote' | null>(null);
  const [isClaimed, setIsClaimed] = useState(false);

  const attachSession = useCallback(() => {
    if (!sessionId) return;
    wsService.attachOrResume(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!termContainerRef.current || !sessionId) return;

    const isDark = getSystemTheme() === 'dark';
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Berkeley Mono', 'Geist Mono', ui-monospace, Menlo, Monaco, monospace",
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
      } catch {}
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

    const unsubHistory = wsService.on('history_replay', (msg) => {
      if (msg.type === 'history_replay' && msg.sessionId === sessionId) {
        term.write(msg.output);
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

    const unsubEventHistory = wsService.on('event_history', (msg) => {
      if (msg.type === 'event_history' && msg.sessionId === sessionId) {
        for (const event of msg.events) {
          if (event.type === 'status_change') {
            setStatus(event.status);
          }
        }
      }
    });

    const unsubOwnership = wsService.on('session_ownership', (msg) => {
      if (msg.type === 'session_ownership' && msg.sessionId === sessionId) {
        setSessionOwner(msg.owner);
        setIsClaimed(msg.owner === 'local');
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
      unsubHistory();
      unsubStatus();
      unsubEvents();
      unsubEventHistory();
      unsubOwnership();
      unsubState();
      mql.removeEventListener('change', handleThemeChange);
      term.dispose();
      wsService.send({ type: 'control', action: 'detach_session', sessionId });
      wsService.clearResume(sessionId);
    };
  }, [sessionId, attachSession]);

  async function stopAgent() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'stop_agent', sessionId });
    navigate('/');
  }

  function claimSession() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'claim_session', sessionId });
  }

  function releaseSession() {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'release_session', sessionId });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line-soft bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <StatusDot status={status} />
          <span className="text-[13px] font-medium text-fg">Agent</span>
          <span className="font-mono text-xs text-meta">{sessionId?.slice(0, 8)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessionOwner && (
            <StatusBadge
              status={sessionOwner === 'local' ? 'connected' : 'waiting_input'}
              dot={false}
            />
          )}
          {sessionOwner && (
            <span className="text-xs text-muted">
              {sessionOwner === 'local' ? 'You control' : 'Remote control'}
            </span>
          )}
          {sessionOwner === 'remote' && (
            <Button size="sm" variant="primary" onClick={claimSession}>
              Take Control
            </Button>
          )}
          {isClaimed && sessionOwner === 'local' && (
            <Button size="sm" variant="tertiary" onClick={releaseSession}>
              Release
            </Button>
          )}
          <StatusBadge status={connected ? 'connected' : 'disconnected'} dot={false} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/git/${sessionId}`)}>
            <IconGitBranch className="mr-1.5 h-3.5 w-3.5" />
            Git
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/agent/${sessionId}`)}>
            <IconActivity className="mr-1.5 h-3.5 w-3.5" />
            Events
          </Button>
          <Button size="sm" variant="error" onClick={stopAgent}>
            <IconStop className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      </div>

      <div
        ref={termContainerRef}
        className="flex-1 overflow-hidden rounded-md border border-line-soft"
        style={{ background: 'var(--terminal-bg)' }}
      />
    </div>
  );
}
