import { useEffect, useState, type ReactNode } from 'react';
import { wsService, type ConnectionMode } from '../services/websocket.js';
import { useThemeStore, type ThemeMode } from '../stores/theme.js';
import { PageHeader, Card, Button, Input, SegmentedControl } from '../lib/ui.js';
import { IconAlertCircle, IconCheck, IconMonitor, IconMoon, IconSun } from '../lib/icons.js';

/**
 * Connection first (with a live summary), then mobile pairing, appearance,
 * about — a narrow reading column, because settings are forms.
 */
export function SettingsScreen() {
  const [mode, setMode] = useState<ConnectionMode>(wsService.mode);
  const [localHttpUrl, setLocalHttpUrl] = useState(`http://${window.location.hostname}:3210`);
  const [relayUrl, setRelayUrl] = useState('');
  const [hostId, setHostId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(wsService.connected);

  useEffect(() => {
    const unsub = wsService.on('_state', () => setConnected(wsService.connected));
    return unsub;
  }, []);

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

  const summaryHeadline = connected
    ? wsService.mode === 'local'
      ? 'Connected to local daemon'
      : 'Connected via relay'
    : 'Not connected';
  const summaryDesc =
    wsService.mode === 'local'
      ? 'Local · direct HTTP + WebSocket · HTTP 3210 / WS 3211'
      : 'Remote · NaCl box E2E over relay';
  const endpoint =
    wsService.mode === 'local' ? wsService.httpUrl : (wsService.relayUrl ?? 'not configured');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Connection, pairing, and how Baton looks." />

      {/* Live connection summary */}
      <Card padding={false} className="mb-1">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              connected ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
            }`}
          >
            {connected ? <IconCheck className="h-4 w-4" /> : <IconAlertCircle className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg">{summaryHeadline}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{summaryDesc}</div>
          </div>
          <span className="hidden max-w-[280px] truncate rounded-sm border border-line-soft bg-raised px-2 py-1 font-mono text-[11px] text-fg-2 sm:block">
            {endpoint}
          </span>
        </div>
      </Card>

      <GroupLabel>Connection</GroupLabel>
      <Card>
        <SegmentedControl
          value={mode}
          onChange={(m) => {
            setMode(m);
            setStatus('');
          }}
          options={[
            { key: 'local', label: 'Local' },
            { key: 'remote', label: 'Remote' },
          ]}
        />
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
          {mode === 'local'
            ? 'Direct daemon access — lowest latency when you are on the same network as the host.'
            : 'Relay-backed access — pair once, then reach your host securely from anywhere.'}
        </p>

        {mode === 'local' ? (
          <div className="mt-4">
            <FieldBlock label="Daemon HTTP URL" hint="The HTTP endpoint where your Baton daemon is listening.">
              <Input
                value={localHttpUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalHttpUrl(e.target.value)}
                className="font-mono"
              />
            </FieldBlock>
            <div className="mt-4 flex items-center justify-between gap-3">
              {status ? (
                <InlineNote ok={isSuccess} text={status} />
              ) : (
                <span />
              )}
              <Button variant="primary" onClick={applyLocal}>
                {connected && wsService.mode === 'local' ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <FieldBlock label="Relay WebSocket URL" hint="The public WebSocket address of your Baton relay server.">
              <Input
                placeholder="ws://relay.example.com:3230"
                value={relayUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRelayUrl(e.target.value)}
                className="font-mono"
              />
            </FieldBlock>

            <FieldBlock
              label="Pairing code"
              hint={
              <>
                The 6-digit code displayed by{' '}
                <code className="font-mono text-[11px] text-fg-2">baton daemon pair</code> on the
                host.
              </>
            }
            >
              <div className="flex gap-2">
                <Input
                  placeholder="000000"
                  value={pairingCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingCode(e.target.value)}
                  className="text-center font-mono tracking-[0.4em]"
                  maxLength={6}
                />
                <Button variant="primary" onClick={applyRemote} className="shrink-0 px-3.5">
                  Pair &amp; connect
                </Button>
              </div>
            </FieldBlock>

            {hostId && (
              <div className="flex items-center gap-2.5 rounded-sm border border-success/25 bg-success-soft px-3 py-2">
                <IconCheck className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-[12.5px] font-medium text-success">Paired host</span>
                <span className="ml-auto truncate font-mono text-[11px] text-muted">
                  {hostId}
                </span>
              </div>
            )}

            {status && <InlineNote ok={isSuccess} text={status} />}
          </div>
        )}
      </Card>

      <GroupLabel>Mobile pairing</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-fg">Pair a mobile device</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              Scan the QR code with the Baton mobile app camera — it configures host, relay and
              encryption key in one step.
            </p>
          </div>
          <Button variant="secondary" onClick={fetchPairingQr} disabled={qrLoading} className="shrink-0">
            {qrLoading ? 'Generating…' : pairingQr ? 'Refresh QR' : 'Show QR code'}
          </Button>
        </div>
        {pairingQr && (
          <div className="mt-4 flex flex-col gap-5 border-t border-line-soft pt-4 sm:flex-row sm:items-center">
            <img
              src={pairingQr.qr}
              alt="Baton Pairing QR Code"
              className="h-44 w-44 shrink-0 self-center rounded-md border border-line-soft bg-white p-2"
            />
            <div className="grid min-w-0 gap-1.5">
              {pairingQr.name && <MetaLine k="Host" v={pairingQr.name} />}
              {pairingQr.localHttpUrl && <MetaLine k="LAN URL" v={pairingQr.localHttpUrl} />}
              {pairingQr.relayUrl && <MetaLine k="Relay" v={pairingQr.relayUrl} />}
              <MetaLine k="Fingerprint" v={`${pairingQr.fingerprint.slice(0, 26)}…`} />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                The fingerprint is verified on both sides before the first message.
              </p>
            </div>
          </div>
        )}
      </Card>

      <GroupLabel>Appearance</GroupLabel>
      <ThemeGrid />

      <GroupLabel>About</GroupLabel>
      <Card padding={false} className="divide-y divide-line-soft">
        <InfoRow label="Application" value="Baton" />
        <InfoRow label="Version" value="0.1.0" />
        <InfoRow label="Transport" value="WebSocket + HTTP" />
        <InfoRow label="Encryption" value="NaCl box" />
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Appearance — System / Light / Dark, bound to the
   same store (and localStorage key) as the sidebar
   toggle.
   ───────────────────────────────────────────── */
const THEME_SWATCHES: Record<ThemeMode, { bg: string; chips: string[] }> = {
  system: { bg: 'linear-gradient(90deg, #f7f8f8 50%, #131416 50%)', chips: ['#5e6ad2', '#d6d3d1', '#4a4b50'] },
  light: { bg: '#f7f8f8', chips: ['#5e6ad2', '#e7e5e4', '#a8a29e'] },
  dark: { bg: '#131416', chips: ['#7170ff', '#2a2b2f', '#4a4b50'] },
};

const THEME_OPTIONS: { key: ThemeMode; name: string; desc: string; icon: ReactNode }[] = [
  {
    key: 'system',
    name: 'System',
    desc: 'Follow the OS setting, live',
    icon: <IconMonitor className="h-3 w-3" />,
  },
  {
    key: 'light',
    name: 'Light',
    desc: 'Warm paper, all day',
    icon: <IconSun className="h-3 w-3" />,
  },
  {
    key: 'dark',
    name: 'Dark',
    desc: 'The native medium',
    icon: <IconMoon className="h-3 w-3" />,
  },
];

function ThemeGrid() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {THEME_OPTIONS.map((opt) => {
        const swatch = THEME_SWATCHES[opt.key];
        const selected = mode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => setMode(opt.key)}
            aria-pressed={selected}
            className={`rounded-md border p-3 text-left transition-colors duration-150 ${
              selected
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-field hover:border-line-strong'
            }`}
          >
            <div
              className="mb-2.5 flex h-10 items-end rounded-md border border-line-soft p-1.5"
              style={{ background: swatch.bg }}
            >
              {swatch.chips.map((c, i) => (
                <span
                  key={i}
                  className="mr-1 block h-2 rounded-sm last:mr-0"
                  style={{ background: c, width: [14, 22, 9][i] }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              <span className="text-muted">{opt.icon}</span>
              {opt.name}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted">{opt.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 text-[11px] font-medium uppercase tracking-[0.07em] text-meta">
      {children}
    </div>
  );
}

function InlineNote({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`text-xs leading-relaxed ${ok ? 'text-success' : 'text-danger'}`}>
      {text}
    </span>
  );
}

function MetaLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 font-mono text-xs">
      <span className="w-20 shrink-0 font-sans text-[11px] text-meta">{k}</span>
      <span className="truncate text-fg-2">{v}</span>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-fg-2">{label}</label>
      {children}
      <p className="text-xs text-meta">{hint}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[12.5px] text-fg-2">{value}</span>
    </div>
  );
}
