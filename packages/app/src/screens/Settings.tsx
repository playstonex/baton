import { useState, type ReactNode } from 'react';
import { wsService, type ConnectionMode } from '../services/websocket.js';
import { PageHeader, Card, StatusAlert, Button, Input } from '../lib/ui.js';

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
    setStatus('Connecting to local daemon…');
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
        setStatus('Connected to relay');
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
      setStatus('Reconnecting…');
    }
  }

  const isSuccess = status.includes('Connected') || status.includes('Connecting');

  const [pairingQr, setPairingQr] = useState<{
    qr: string;
    fingerprint: string;
    localHttpUrl?: string;
    relayUrl?: string;
    name?: string;
  } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  async function fetchPairingQr() {
    setQrLoading(true);
    try {
      const res = await fetch(`${localHttpUrl}/api/pair/qr`);
      if (res.ok) {
        const data = await res.json();
        setPairingQr(data);
      } else {
        setStatus('Failed to load pairing QR');
      }
    } catch {
      setStatus('Could not reach daemon for pairing QR');
    } finally {
      setQrLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Tune the way Baton reaches every agent." />

      <div className="grid gap-4 md:grid-cols-2">
        {CONNECTION_MODES.map((item) => {
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
              className={`rounded-md border p-5 text-left transition-colors duration-150 ${
                active
                  ? 'border-accent bg-accent-soft'
                  : 'border-line-soft bg-surface hover:border-line-strong'
              }`}
            >
              <div className="text-xs font-medium text-muted">
                {item.label}
              </div>
              <div className="mt-1.5 text-sm font-semibold text-fg">{item.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{item.body}</p>
            </button>
          );
        })}
      </div>

      {mode === 'local' ? (
        <Card>
          <div className="text-[13px] font-semibold text-fg">Local connection</div>
          <p className="mt-1 text-[13px] text-muted">Point Baton at the daemon</p>
          <div className="mt-5 space-y-5">
            <FieldBlock label="Daemon HTTP URL" hint="The HTTP endpoint where your Baton daemon is listening.">
              <Input
                value={localHttpUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalHttpUrl(e.target.value)}
                className="font-mono"
              />
            </FieldBlock>
            <Button variant="primary" onClick={applyLocal} className="w-full">
              Connect to Local Daemon
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="text-[13px] font-semibold text-fg">Remote pairing</div>
          <p className="mt-1 text-[13px] text-muted">Pair through the relay</p>
          <div className="mt-5 space-y-5">
            <FieldBlock label="Relay WebSocket URL" hint="The public WebSocket address of your Baton relay server.">
              <Input
                placeholder="ws://relay.example.com:3230"
                value={relayUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelayUrl(e.target.value)}
                className="font-mono"
              />
            </FieldBlock>

            <FieldBlock label="Pairing code" hint="Use the 6-digit code displayed by the host daemon.">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="000000"
                    value={pairingCode}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingCode(e.target.value)}
                    className="text-center font-mono tracking-[0.4em]"
                    maxLength={6}
                  />
                </div>
                <Button variant="primary" onClick={applyRemote} className="px-4">
                  Pair & Connect
                </Button>
              </div>
            </FieldBlock>

            {hostId && (
              <StatusAlert type="success" title="Paired host" message={`${hostId.slice(0, 8)}…`} />
            )}
          </div>
        </Card>
      )}

      {status && (
        <StatusAlert
          type={isSuccess ? 'success' : 'error'}
          title={isSuccess ? 'Connection status' : 'Action required'}
          message={status}
        />
      )}

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold text-fg">Pair mobile device</div>
            <p className="mt-1 text-[13px] text-muted">
              Scan the QR code with the Baton mobile app camera to connect automatically.
            </p>
          </div>
          <Button variant="secondary" onClick={fetchPairingQr} disabled={qrLoading}>
            {qrLoading ? 'Generating…' : pairingQr ? 'Refresh QR' : 'Show QR Code'}
          </Button>
        </div>
        {pairingQr && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-md border border-line-soft bg-canvas p-6">
            <img
              src={pairingQr.qr}
              alt="Baton Pairing QR Code"
              className="h-56 w-56 rounded-md border border-line-soft bg-white p-2"
            />
            <div className="w-full space-y-1 text-center font-mono text-xs text-muted">
              {pairingQr.name && (
                <div>
                  Host: <span className="text-fg-2">{pairingQr.name}</span>
                </div>
              )}
              {pairingQr.localHttpUrl && (
                <div>
                  LAN URL: <span className="text-fg-2">{pairingQr.localHttpUrl}</span>
                </div>
              )}
              <div className="truncate">
                Fingerprint: <span className="text-fg-2">{pairingQr.fingerprint.slice(0, 16)}…</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="text-[13px] font-semibold text-fg">Environment</div>
        <div className="mt-3 divide-y divide-line-soft">
          <InfoRow label="Application" value="Baton" />
          <InfoRow label="Version" value="0.1.0" />
          <InfoRow label="Transport" value="WebSocket + HTTP" />
          <InfoRow label="Encryption" value="NaCl box" />
        </div>
      </Card>

      <div className="rounded-md border border-line-soft bg-raised/60 p-5">
        <div className="text-xs font-medium text-muted">
          Current mode
        </div>
        <div className="mt-1 text-base font-semibold text-fg">
          {mode === 'local' ? 'Local Network' : 'Remote Relay'}
        </div>
        <p className="mt-1 text-[13px] text-muted">
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
      <label className="text-xs font-medium text-muted">{label}</label>
      {children}
      <p className="text-xs text-meta">{hint}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[13px] text-fg-2">{value}</span>
    </div>
  );
}
