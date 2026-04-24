import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { wsService, type ConnectionMode } from '../services/websocket.js';

export function SettingsScreen() {
  const [mode, setMode] = useState<ConnectionMode>(wsService.mode);
  const [localHttpUrl, setLocalHttpUrl] = useState(`http://${window.location.hostname}:3210`);
  const [relayUrl, setRelayUrl] = useState('');
  const [hostId, setHostId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [status, setStatus] = useState('');

  function applyLocal() {
    const hostname = new URL(localHttpUrl).hostname;
    wsService.configure({
      mode: 'local',
      localWsUrl: `ws://${hostname}:3211`,
      localHttpUrl,
    });
    wsService.disconnect();
    wsService.connect();
    setMode('local');
    setStatus('Connecting to local daemon...');
  }

  async function applyRemote() {
    if (pairingCode && !hostId) {
      try {
        const gatewayUrl = `${relayUrl.replace('ws', 'http')}`.replace(/:\d+/, ':3220');
        const res = await fetch(`${gatewayUrl}/api/v1/auth/verify-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairingCode }),
        });
        if (res.ok) {
          const data = await res.json();
          setHostId(data.hostId);
          wsService.configure({
            mode: 'remote',
            relayUrl,
            hostId: data.hostId,
            token: data.token,
          });
          wsService.disconnect();
          wsService.connect();
          setMode('remote');
          setStatus('Connected to relay!');
        } else {
          setStatus('Invalid pairing code');
        }
      } catch {
        setStatus('Failed to connect to gateway');
      }
      return;
    }

    if (hostId) {
      wsService.configure({ mode: 'remote', relayUrl, hostId });
      wsService.disconnect();
      wsService.connect();
      setMode('remote');
      setStatus('Reconnecting...');
    }
  }

  const isSuccess = status.includes('Connected') || status.includes('Connecting');

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h2 className="text-xl font-bold text-surface-900 dark:text-white">Settings</h2>
        <p className="mt-1 text-sm text-surface-400">Configure how Baton connects to your agents</p>
      </div>

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Connection Mode</h3>
          <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className={`group relative rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
              mode === 'local'
                ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-200 dark:border-primary-400 dark:bg-primary-950/60 dark:shadow-none'
                : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-surface-600'
            }`}
            onClick={() => setMode('local')}
          >
            {mode === 'local' && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-white">
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              </div>
            )}
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/50">
              <LocalIcon className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="text-sm font-semibold text-surface-900 dark:text-white">Local</div>
            <p className="mt-1 text-xs leading-relaxed text-surface-500">Same network, direct connection to daemon</p>
          </button>
          <button
            type="button"
            className={`group relative rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
              mode === 'remote'
                ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-200 dark:border-primary-400 dark:bg-primary-950/60 dark:shadow-none'
                : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-surface-600'
            }`}
            onClick={() => setMode('remote')}
          >
            {mode === 'remote' && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-white">
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              </div>
            )}
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
              <RemoteIcon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="text-sm font-semibold text-surface-900 dark:text-white">Remote</div>
            <p className="mt-1 text-xs leading-relaxed text-surface-500">Via Relay, connect from anywhere</p>
          </button>
        </div>
      </div>

      {mode === 'local' ? (
        <div className="space-y-3 rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-800/50">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Daemon HTTP URL
            </label>
            <Input
              value={localHttpUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalHttpUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="mt-1.5 text-xs text-surface-400">The HTTP URL where your Baton daemon is running</p>
          </div>
          <Button variant="primary" onPress={applyLocal} className="w-full">
            Connect
          </Button>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-800/50">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Relay WebSocket URL
            </label>
            <Input
              placeholder="ws://relay.example.com:3230"
              value={relayUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelayUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="mt-1.5 text-xs text-surface-400">The WebSocket URL of the Baton relay server</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Pairing Code
            </label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Input
                  placeholder="● ● ● ● ● ●"
                  value={pairingCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingCode(e.target.value)}
                  className="font-mono text-sm text-center tracking-[0.5em]"
                  maxLength={6}
                />
              </div>
              <Button variant="primary" onPress={applyRemote}>
                Pair & Connect
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-surface-400">
              Get the 6-digit code from your host machine's Daemon terminal
            </p>
          </div>

          {hostId && (
            <div className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 dark:bg-success-950/30">
              <svg className="h-4 w-4 text-success-600 dark:text-success-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8.5l4 4 8-9" />
              </svg>
              <span className="text-xs font-medium text-success-700 dark:text-success-400">
                Paired with host: <span className="font-mono">{hostId.slice(0, 8)}</span>...
              </span>
            </div>
          )}
        </div>
      )}

      {status && (
        <div
          className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 ${
            isSuccess
              ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-800 dark:bg-success-950/30 dark:text-success-400'
              : 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-800 dark:bg-danger-950/30 dark:text-danger-400'
          }`}
        >
          {isSuccess ? (
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M5 8l2 2 4-4" />
            </svg>
          ) : (
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3.5M8 11v0" />
            </svg>
          )}
          <span className="text-sm font-medium">{status}</span>
        </div>
      )}

      <div className="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-800/50">
        <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">About</h3>
        <div className="space-y-2 text-xs text-surface-400">
          <div className="flex items-center justify-between">
            <span>Application</span>
            <span className="font-mono text-surface-600 dark:text-surface-300">Baton</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Version</span>
            <span className="font-mono text-surface-600 dark:text-surface-300">0.1.0</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Protocol</span>
            <span className="font-mono text-surface-600 dark:text-surface-300">WebSocket + HTTP</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Encryption</span>
            <span className="font-mono text-surface-600 dark:text-surface-300">NaCl (xsalsa20-poly1305)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LocalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5 14h6M8 11v3" />
    </svg>
  );
}

function RemoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M4.93 4.93a5 5 0 0 0 0 6.14M11.07 4.93a5 5 0 0 1 0 6.14" />
      <path d="M2.5 2.5a9 9 0 0 0 0 11M13.5 2.5a9 9 0 0 1 0 11" />
    </svg>
  );
}
