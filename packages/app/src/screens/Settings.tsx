import { useState } from 'react';
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
    // Step 1: If we have a pairing code, verify it
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

    // Step 2: If we have hostId, just connect
    if (hostId) {
      wsService.configure({ mode: 'remote', relayUrl, hostId });
      wsService.disconnect();
      wsService.connect();
      setMode('remote');
      setStatus('Reconnecting...');
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h2>Settings</h2>

      {/* Connection Mode */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15 }}>Connection</h3>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setMode('local')}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: `2px solid ${mode === 'local' ? '#2563eb' : '#e5e7eb'}`,
              borderRadius: 8,
              background: mode === 'local' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>Local</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Same network, direct connection</div>
          </button>
          <button
            onClick={() => setMode('remote')}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: `2px solid ${mode === 'remote' ? '#2563eb' : '#e5e7eb'}`,
              borderRadius: 8,
              background: mode === 'remote' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>Remote</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Via Relay, anywhere</div>
          </button>
        </div>

        {mode === 'local' ? (
          <div>
            <label style={{ fontSize: 13, color: '#374151', display: 'block', marginBottom: 4 }}>
              Daemon URL
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={localHttpUrl}
                onChange={(e) => setLocalHttpUrl(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace' }}
              />
              <button onClick={applyLocal} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Connect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, color: '#374151', display: 'block', marginBottom: 4 }}>
                Relay URL
              </label>
              <input
                type="text"
                placeholder="ws://relay.example.com:3230"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: '#374151', display: 'block', marginBottom: 4 }}>
                Pairing Code
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="123456"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                  maxLength={6}
                  style={{ width: 120, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 4 }}
                />
                <button onClick={applyRemote} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  Pair & Connect
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                Get the code from your host machine's Daemon terminal
              </p>
            </div>
            {hostId && (
              <p style={{ fontSize: 12, color: '#22c55e' }}>
                Paired with host: {hostId.slice(0, 8)}...
              </p>
            )}
          </div>
        )}
      </div>

      {status && (
        <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, color: '#166534' }}>
          {status}
        </div>
      )}
    </div>
  );
}
