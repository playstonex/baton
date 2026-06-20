import { useState, type ReactNode } from 'react';
import { Button, Input } from '@heroui/react';
import { wsService, type ConnectionMode } from '../services/websocket.js';
import { PageHeader, Card, StatusAlert } from '../lib/ui.js';

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
    <div className="space-y-10">
      <PageHeader title="Settings" description="Tune the way Baton reaches every agent." />

      <div className="grid gap-4 md:grid-cols-2">
        {CONNECTION_MODES.map((item) => {
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
              className={`rounded-lg border p-6 text-left transition-colors ${
                active
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/40'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {item.label}
              </div>
              <div className="mt-2 text-base font-medium text-gray-900 dark:text-white">
                {item.title}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {item.body}
              </p>
            </button>
          );
        })}
      </div>

      {mode === 'local' ? (
        <Card>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            Local Connection
          </div>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            Point Baton at the daemon
          </p>
          <div className="mt-5 space-y-5">
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
        </Card>
      ) : (
        <Card>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            Remote Pairing
          </div>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            Pair through the relay
          </p>
          <div className="mt-5 space-y-5">
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
              <StatusAlert
                type="success"
                title="Paired host"
                message={`${hostId.slice(0, 8)}...`}
              />
            )}
          </div>
        </Card>
      )}

      {status && (
        <StatusAlert
          type={isSuccess ? 'success' : 'error'}
          title={isSuccess ? 'Connection Status' : 'Action Required'}
          message={status}
        />
      )}

      <Card>
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          Environment
        </div>
        <div className="mt-4 space-y-2.5">
          <InfoRow label="Application" value="Baton" />
          <InfoRow label="Version" value="0.1.0" />
          <InfoRow label="Transport" value="WebSocket + HTTP" />
          <InfoRow label="Encryption" value="NaCl box" />
        </div>
      </Card>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Current Mode
        </div>
        <div className="mt-1 text-lg font-medium text-gray-900 dark:text-white">
          {mode === 'local' ? 'Local Network' : 'Remote Relay'}
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
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
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
      </label>
      {children}
      <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0 dark:border-gray-700">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-mono text-sm text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  );
}
