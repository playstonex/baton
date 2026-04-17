import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useConnectionStore } from '../../src/stores/connection';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';

export default function SettingsScreen() {
  const { mode, setMode, relayUrl, hostId, localHttpUrl, localWsUrl, connected, setCredentials, setConnected } =
    useConnectionStore();
  const [inputRelayUrl, setInputRelayUrl] = useState(relayUrl);
  const [inputPairingCode, setInputPairingCode] = useState('');
  const [inputLocalHttp, setInputLocalHttp] = useState(localHttpUrl);
  const [inputLocalWs, setInputLocalWs] = useState(localWsUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function pairAndConnect() {
    if (!inputRelayUrl.trim() || !inputPairingCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      const gatewayUrl = inputRelayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3220');
      const res = await fetch(`${gatewayUrl}/api/v1/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inputPairingCode.trim() }),
      });
      const data = (await res.json()) as { token?: string; hostId?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Pairing failed');
        return;
      }

      const config = {
        mode: 'remote' as const,
        relayUrl: inputRelayUrl.trim(),
        hostId: data.hostId,
        token: data.token,
      };
      setCredentials(config);
      await saveCredentials(config);
      wsService.configure(config);
      wsService.connect();
      setInputPairingCode('');
    } catch (err) {
      setError(`Connection failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function connectLocal() {
    if (!inputLocalHttp.trim()) return;
    setLoading(true);
    setError('');
    const config = {
      mode: 'local' as const,
      localHttpUrl: inputLocalHttp.trim(),
      localWsUrl: inputLocalWs.trim() || inputLocalHttp.trim().replace(/^http/, 'ws').replace(/:\d+/, ':3211'),
    };
    setCredentials(config);
    await saveCredentials(config);
    wsService.configure(config);
    wsService.connect();
    setLoading(false);
  }

  async function disconnect() {
    wsService.disconnect();
    setConnected(false);
    await clearCredentials();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 16 }}>Settings</Text>

        {/* Mode toggle */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
          {(['remote', 'local'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: mode === m ? '#2563eb' : '#e5e7eb',
                backgroundColor: mode === m ? '#eff6ff' : '#f9fafb',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontWeight: '600', color: mode === m ? '#2563eb' : '#374151' }}>{m === 'remote' ? 'Remote' : 'Local'}</Text>
              <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{m === 'remote' ? 'Via Relay' : 'Same network'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'remote' ? (
          <>
            <Text style={{ fontSize: 15, fontWeight: '600', marginBottom: 8 }}>Remote Connection</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Enter relay URL and 6-digit pairing code from the host</Text>

            <TextInput
              placeholder="Relay URL (e.g. ws://192.168.1.100:3230)"
              value={inputRelayUrl}
              onChangeText={setInputRelayUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, fontSize: 14, fontFamily: 'monospace', marginBottom: 8 }}
            />

            <TextInput
              placeholder="6-digit pairing code"
              value={inputPairingCode}
              onChangeText={setInputPairingCode}
              keyboardType="number-pad"
              maxLength={6}
              style={{ padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, fontSize: 20, textAlign: 'center', letterSpacing: 8, marginBottom: 12 }}
            />

            <TouchableOpacity
              onPress={pairAndConnect}
              disabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
              style={{
                padding: 14,
                backgroundColor: loading ? '#93c5fd' : '#2563eb',
                borderRadius: 8,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Pair & Connect</Text>}
            </TouchableOpacity>

            {connected && hostId ? (
              <View style={{ padding: 12, backgroundColor: '#dcfce7', borderRadius: 8, marginBottom: 12 }}>
                <Text style={{ color: '#166534', fontSize: 13 }}>Connected to host: {hostId.slice(0, 8)}...</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={{ fontSize: 15, fontWeight: '600', marginBottom: 8 }}>Local Connection</Text>

            <TextInput
              placeholder="Daemon HTTP URL"
              value={inputLocalHttp}
              onChangeText={setInputLocalHttp}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, fontSize: 14, fontFamily: 'monospace', marginBottom: 8 }}
            />

            <TextInput
              placeholder="Daemon WebSocket URL (auto-derived)"
              value={inputLocalWs}
              onChangeText={setInputLocalWs}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, fontSize: 14, fontFamily: 'monospace', marginBottom: 12 }}
            />

            <TouchableOpacity
              onPress={connectLocal}
              disabled={loading || !inputLocalHttp.trim()}
              style={{
                padding: 14,
                backgroundColor: loading ? '#93c5fd' : '#2563eb',
                borderRadius: 8,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Connect</Text>}
            </TouchableOpacity>
          </>
        )}

        {error ? (
          <View style={{ padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ color: '#991b1b', fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        {connected && (
          <TouchableOpacity onPress={disconnect} style={{ padding: 12, borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, alignItems: 'center' }}>
            <Text style={{ color: '#dc2626', fontWeight: '500' }}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
