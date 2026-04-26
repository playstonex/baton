import { useState, type ReactNode } from 'react';
import { Button, Input } from '@heroui/react';
import { wsService, type ConnectionMode } from '../services/websocket.js';

const CONNECTION_MODES = [
  {
    key: 'local' as const,
    label: 'Local',
    title: 'Direct daemon access',
    body: 'Best on the same network when you want the fastest response and the least moving parts.',
  },
  {
    key: 'remote' as const,
    label: 'Remote',
    title: 'Relay-backed access',
    body: 'Use pairing and relay routing to reach your host securely from anywhere.',
  },
] as const;

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

        if (!res.ok) {
          setStatus('Invalid pairing code');
          return;
        }

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
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-surface-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Tune the way Baton reaches every agent.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {CONNECTION_MODES.map((item) => {
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/40'
                  : 'border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800/50 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {item.label}
              </div>
              <div className="mt-2 text-base font-medium text-surface-900 dark:text-white">
                {item.title}
              </div>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                {item.body}
              </p>
            </button>
          );
        })}
      </div>

      {mode === 'local' ? (
        <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800/50">
          <div className="text-sm font-semibold text-surface-900 dark:text-white">
            Local Connection
          </div>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Point Baton at the daemon
          </p>
          <div className="mt-4 space-y-4">
            <FieldBlock
              label="Daemon HTTP URL"
              hint="The HTTP endpoint where your Baton daemon is listening."
            >
              <Input
                value={localHttpUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalHttpUrl(e.target.value)
                }
                className="font-mono text-sm"
              />
            </FieldBlock>
            <Button variant="primary" onPress={applyLocal} className="w-full">
              Connect to Local Daemon
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800/50">
          <div className="text-sm font-semibold text-surface-900 dark:text-white">
            Remote Pairing
          </div>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Pair through the relay
          </p>
          <div className="mt-4 space-y-4">
            <FieldBlock
              label="Relay WebSocket URL"
              hint="The public WebSocket address of your Baton relay server."
            >
              <Input
                placeholder="ws://relay.example.com:3230"
                value={relayUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRelayUrl(e.target.value)
                }
                className="font-mono text-sm"
              />
            </FieldBlock>

            <FieldBlock
              label="Pairing Code"
              hint="Use the 6-digit code displayed by the host daemon."
            >
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input
                    placeholder="000000"
                    value={pairingCode}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPairingCode(e.target.value)
                    }
                    className="font-mono text-center text-sm tracking-[0.4em]"
                    maxLength={6}
                  />
                </div>
                <Button variant="primary" onPress={applyRemote} className="px-5">
                  Pair & Connect
                </Button>
              </div>
            </FieldBlock>

            {hostId && (
              <div className="rounded border border-success-200 bg-success-50 px-3 py-2 dark:border-success-800 dark:bg-success-950/25">
                <div className="text-xs font-semibold text-success-700 dark:text-success-400">
                  Paired host
                </div>
                <div className="mt-0.5 font-mono text-xs text-success-700/80 dark:text-success-400/85">
                  {hostId.slice(0, 8)}...
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {status && (
        <div
          className={`rounded border px-3 py-2 ${
            isSuccess
              ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-800 dark:bg-success-950/25 dark:text-success-400'
              : 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-800 dark:bg-danger-950/25 dark:text-danger-400'
          }`}
        >
          <div className="text-sm font-medium">
            {isSuccess ? 'Connection Status' : 'Action Required'}
          </div>
          <div className="mt-0.5 text-sm">{status}</div>
        </div>
      )}

      <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800/50">
        <div className="text-sm font-semibold text-surface-900 dark:text-white">
          Environment
        </div>
        <div className="mt-3 space-y-2">
          <InfoRow label="Application" value="Baton" />
          <InfoRow label="Version" value="0.1.0" />
          <InfoRow label="Transport" value="WebSocket + HTTP" />
          <InfoRow label="Encryption" value="NaCl box" />
        </div>
      </div>

      <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900">
        <div className="text-xs font-medium uppercase tracking-wider text-surface-500">
          Current Mode
        </div>
        <div className="mt-1 text-lg font-medium text-surface-900 dark:text-white">
          {mode === 'local' ? 'Local Network' : 'Remote Relay'}
        </div>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {mode === 'local'
            ? 'Direct HTTP and WebSocket connectivity for the lowest latency setup.'
            : 'Relay and pairing flow for secure access outside the local environment.'}
        </p>
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-surface-600 dark:text-surface-400">
        {label}
      </label>
      {children}
      <p className="text-xs text-surface-400 dark:text-surface-500">{hint}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-surface-100 py-1.5 last:border-0 dark:border-surface-700">
      <span className="text-sm text-surface-500 dark:text-surface-400">{label}</span>
      <span className="font-mono text-sm text-surface-700 dark:text-surface-300">{value}</span>
    </div>
  );
}