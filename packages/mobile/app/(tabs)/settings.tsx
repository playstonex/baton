import { StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { View, Text } from 'react-native';
import { useState } from 'react';
import { Button, Input, Spinner } from 'heroui-native';
import { useConnectionStore } from '../../src/stores/connection';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';

export default function SettingsScreen() {
  const mode = useConnectionStore((s) => s.mode);
  const setMode = useConnectionStore((s) => s.setMode);
  const relayUrl = useConnectionStore((s) => s.relayUrl);
  const hostId = useConnectionStore((s) => s.hostId);
  const localHttpUrl = useConnectionStore((s) => s.localHttpUrl);
  const localWsUrl = useConnectionStore((s) => s.localWsUrl);
  const connected = useConnectionStore((s) => s.connected);
  const setCredentials = useConnectionStore((s) => s.setCredentials);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const [inputRelayUrl, setInputRelayUrl] = useState(relayUrl);
  const [inputPairingCode, setInputPairingCode] = useState('');
  const [inputLocalHttp, setInputLocalHttp] = useState(localHttpUrl);
  const [inputLocalWs, setInputLocalWs] = useState(localWsUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function pairAndConnect() {
    if (!inputRelayUrl.trim() || !inputPairingCode.trim()) return;
    setLoading(true); setError('');
    try {
      const gatewayUrl = inputRelayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3220');
      const res = await fetch(`${gatewayUrl}/api/v1/auth/verify-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: inputPairingCode.trim() }) });
      const data = (await res.json()) as { token?: string; hostId?: string; error?: string };
      if (!res.ok) { setError(data.error ?? 'Pairing failed'); return; }
      const config = { mode: 'remote' as const, relayUrl: inputRelayUrl.trim(), hostId: data.hostId, token: data.token };
      setCredentials(config); await saveCredentials(config); wsService.configure(config); wsService.connect(); setInputPairingCode('');
    } catch (err) { setError(`Connection failed: ${err}`); }
    finally { setLoading(false); }
  }

  async function connectLocal() {
    if (!inputLocalHttp.trim()) return;
    setLoading(true); setError('');
    const config = { mode: 'local' as const, localHttpUrl: inputLocalHttp.trim(), localWsUrl: inputLocalWs.trim() || inputLocalHttp.trim().replace(/^http/, 'ws').replace(/:\d+/, ':3211') };
    setCredentials(config); await saveCredentials(config); wsService.configure(config); wsService.connect(); setLoading(false);
  }

  async function disconnect() { wsService.disconnect(); setConnected(false); await clearCredentials(); }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={styles.modeRow}>
          {(['remote', 'local'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setMode(m)}
              style={{ flex: 1 }}
            >
              {m === 'remote' ? 'Remote' : 'Local'}
            </Button>
          ))}
        </View>

        {mode === 'remote' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remote Connection</Text>
            <Text style={styles.sectionDesc}>Enter relay URL and 6-digit pairing code from the host</Text>
            <Input
              placeholder="Relay URL (e.g. ws://192.168.1.100:3230)"
              value={inputRelayUrl}
              onChangeText={setInputRelayUrl}
              autoCapitalize="none"
              autoCorrect={false}
              variant="secondary"
            />
            <Input
              placeholder="6-digit pairing code"
              value={inputPairingCode}
              onChangeText={setInputPairingCode}
              keyboardType="number-pad"
              maxLength={6}
              variant="secondary"
            />
            <Button
              variant="primary"
              onPress={pairAndConnect}
              isDisabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
            >
              {loading ? <Spinner size="sm" color="#fff" /> : 'Pair & Connect'}
            </Button>
            {connected && hostId ? (<View style={styles.successBox}><Text style={styles.successText}>Connected to host: {hostId.slice(0, 8)}...</Text></View>) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Local Connection</Text>
            <Input
              placeholder="Daemon HTTP URL"
              value={inputLocalHttp}
              onChangeText={setInputLocalHttp}
              autoCapitalize="none"
              autoCorrect={false}
              variant="secondary"
            />
            <Input
              placeholder="Daemon WebSocket URL (auto-derived)"
              value={inputLocalWs}
              onChangeText={setInputLocalWs}
              autoCapitalize="none"
              autoCorrect={false}
              variant="secondary"
            />
            <Button
              variant="primary"
              onPress={connectLocal}
              isDisabled={loading || !inputLocalHttp.trim()}
            >
              {loading ? <Spinner size="sm" color="#fff" /> : 'Connect'}
            </Button>
          </View>
        )}

        {error ? (<View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>) : null}
        {connected && (<Button variant="danger-soft" onPress={disconnect}>Disconnect</Button>)}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16, gap: 16 },
  modeRow: { flexDirection: 'row', gap: 8 },
  section: { gap: 8 },
  sectionTitle: { fontWeight: '600', fontSize: 16, color: '#fff', marginBottom: 4 },
  sectionDesc: { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  successBox: { padding: 12, backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#22c55e' },
  successText: { color: '#4ade80', fontSize: 13 },
  errorBox: { padding: 12, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#ef4444', marginTop: 8 },
  errorText: { color: '#f87171', fontSize: 13 },
});
