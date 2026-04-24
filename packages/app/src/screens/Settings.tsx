import { useState } from 'react';
import { Button, Input, Chip } from '@heroui/react';
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

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <h2 className="text-xl font-bold text-surface-900 dark:text-white">Settings</h2>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Connection</h3>

        <div className="flex gap-3">
          <div
            className={`flex-1 cursor-pointer rounded-xl border-2 p-4 transition-colors ${mode === 'local' ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50' : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800'}`}
            onClick={() => setMode('local')}
          >
            <div className="flex items-center gap-2">
              <LocalIcon className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              <span className="text-sm font-semibold text-surface-900 dark:text-white">Local</span>
            </div>
            <p className="mt-1 text-xs text-surface-500">Same network, direct connection</p>
          </div>
          <div
            className={`flex-1 cursor-pointer rounded-xl border-2 p-4 transition-colors ${mode === 'remote' ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50' : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800'}`}
            onClick={() => setMode('remote')}
          >
            <div className="flex items-center gap-2">
              <RemoteIcon className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              <span className="text-sm font-semibold text-surface-900 dark:text-white">Remote</span>
            </div>
            <p className="mt-1 text-xs text-surface-500">Via Relay, anywhere</p>
          </div>
        </div>

        {mode === 'local' ? (
          <div className="space-y-2">
            <Input
              value={localHttpUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalHttpUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <Button variant="primary" onPress={applyLocal}>
              Connect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="ws://relay.example.com:3230"
              value={relayUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelayUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <div className="flex gap-2 items-end">
              <Input
                placeholder="123456"
                value={pairingCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingCode(e.target.value)}
                className="w-32 font-mono text-sm text-center tracking-widest"
                maxLength={6}
              />
              <Button variant="primary" onPress={applyRemote}>
                Pair & Connect
              </Button>
            </div>
            <p className="text-xs text-surface-400">
              Get the code from your host machine's Daemon terminal
            </p>
            {hostId && (
              <Chip size="sm" variant="primary">
                Paired with host: {hostId.slice(0, 8)}...
              </Chip>
            )}
          </div>
        )}
      </div>

      {status && (
        <Chip variant="soft" color={status.includes('Connected') || status.includes('Connecting') ? 'success' : 'danger'}>
          {status}
        </Chip>
      )}
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
