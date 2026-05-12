import { KeyboardAvoidingView, Platform, View, Text, Pressable, ScrollView } from 'react-native';
import { useState } from 'react';
import { Button, Input, Spinner } from 'heroui-native';
import { useConnectionStore } from '../../src/stores/connection';
import { useRecentStore } from '../../src/stores/recent';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';
import { useThemeStore, type ThemeMode } from '../../src/stores/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

const THEME_OPTIONS: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'system', label: 'System', desc: 'Follow device' },
  { key: 'light', label: 'Light', desc: 'Always light' },
  { key: 'dark', label: 'Dark', desc: 'Always dark' },
];

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

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

  const recentConnections = useRecentStore((s) => s.connections);
  const addRecentConnection = useRecentStore((s) => s.addConnection);
  const removeRecentConnection = useRecentStore((s) => s.removeConnection);

  const themeMode = useThemeStore((s) => s.theme);
  const setThemeMode = useThemeStore((s) => s.setTheme);
  const c = useThemeColors();

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
      const gatewayUrl = inputRelayUrl
        .replace(/^wss?/, 'http')
        .replace(/:\d+/, ':3220');
      const res = await fetch(`${gatewayUrl}/api/v1/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inputPairingCode.trim() }),
      });
      const data = (await res.json()) as {
        token?: string;
        hostId?: string;
        error?: string;
      };
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
      addRecentConnection(config);
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
      localWsUrl:
        inputLocalWs.trim() ||
        inputLocalHttp.trim().replace(/^http/, 'ws').replace(/:\d+/, ':3211'),
    };
    setCredentials(config);
    await saveCredentials(config);
    addRecentConnection(config);
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
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-2xl font-semibold mb-2" style={{ color: c.textPrimary }}>
          Settings
        </Text>

        <View className="rounded-lg border p-4 gap-3" style={{ borderColor: c.cardBorder }}>
          <Text className="text-xs font-medium mb-1" style={{ color: c.textTertiary }}>
            Appearance
          </Text>
          <View className="flex-row gap-2">
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setThemeMode(opt.key)}
                  className="flex-1 rounded-md border p-2.5 items-center"
                  style={{
                    backgroundColor: active ? '#eff6ff' : c.subtle,
                    borderColor: active ? '#2383e2' : c.cardBorder,
                  }}
                >
                  <Text
                    className="text-[13px] font-medium"
                    style={{ color: active ? '#1d4ed8' : c.textSecondary }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="rounded-lg border p-4 gap-3" style={{ borderColor: c.cardBorder }}>
          <Text className="text-xs font-medium mb-1" style={{ color: c.textTertiary }}>
            Connection
          </Text>
          <View className="flex-row gap-2">
            {(['local', 'remote'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className="flex-1 rounded-md border p-2.5 items-center"
                  style={{
                    backgroundColor: active ? '#eff6ff' : c.subtle,
                    borderColor: active ? '#2383e2' : c.cardBorder,
                  }}
                >
                  <Text
                    className="text-[13px] font-medium"
                    style={{ color: active ? '#1d4ed8' : c.textSecondary }}
                  >
                    {m === 'remote' ? 'Remote' : 'Local'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {recentConnections.length > 0 && (
          <View className="rounded-lg border p-4 gap-3" style={{ borderColor: c.cardBorder }}>
            <Text className="text-xs font-medium mb-1" style={{ color: c.textTertiary }}>
              Recent Connections
            </Text>
            <View className="gap-1.5">
              {recentConnections.map((conn, i) => (
                <View key={i} className="flex-row items-center gap-1.5">
                  <Pressable
                    onPress={() => {
                      if (conn.mode === 'local') {
                        setMode('local');
                        setInputLocalHttp(conn.localHttpUrl ?? '');
                        setInputLocalWs(conn.localWsUrl ?? '');
                      } else {
                        setMode('remote');
                        setInputRelayUrl(conn.relayUrl ?? '');
                      }
                    }}
                    className="flex-1 flex-row items-center gap-2.5 rounded-lg border p-2.5"
                    style={({ pressed }) => ({
                      backgroundColor: pressed ? c.subtle : c.elevated,
                      borderColor: c.cardBorder,
                    })}
                  >
                    <Text className="text-lg">
                      {conn.mode === 'local' ? '🏠' : '🌐'}
                    </Text>
                    <View className="flex-1">
                      <Text
                        className="text-[13px] font-medium"
                        style={{ color: c.textPrimary }}
                        numberOfLines={1}
                      >
                        {conn.label}
                      </Text>
                      <Text className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>
                        {formatTime(conn.lastUsed)}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => removeRecentConnection(i)}
                    className="w-8 h-8 rounded-lg border items-center justify-center"
                    style={{ borderColor: c.cardBorder }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: c.textTertiary }}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {mode === 'remote' ? (
          <View className="rounded-lg border p-4 gap-3" style={{ borderColor: c.cardBorder }}>
            <View className="gap-1.5">
              <Text className="text-xs font-medium" style={{ color: c.textSecondary }}>Relay URL</Text>
              <Input
                placeholder="ws://host:3230"
                value={inputRelayUrl}
                onChangeText={setInputRelayUrl}
                autoCapitalize="none"
                autoCorrect={false}
                variant="secondary"
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-xs font-medium" style={{ color: c.textSecondary }}>
                Pairing Code ({inputPairingCode.length}/6)
              </Text>
              <Input
                placeholder="000000"
                value={inputPairingCode}
                onChangeText={setInputPairingCode}
                keyboardType="number-pad"
                maxLength={6}
                variant="secondary"
              />
            </View>
            <Button
              variant="primary"
              size="md"
              onPress={pairAndConnect}
              isDisabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
            >
              {loading ? <Spinner size="sm" color="#fff" /> : 'Pair & Connect'}
            </Button>
          </View>
        ) : (
          <View className="rounded-lg border p-4 gap-3" style={{ borderColor: c.cardBorder }}>
            <View className="gap-1.5">
              <Text className="text-xs font-medium" style={{ color: c.textSecondary }}>HTTP URL</Text>
              <Input
                placeholder="http://localhost:3210"
                value={inputLocalHttp}
                onChangeText={setInputLocalHttp}
                autoCapitalize="none"
                autoCorrect={false}
                variant="secondary"
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-xs font-medium" style={{ color: c.textSecondary }}>
                WebSocket URL (optional)
              </Text>
              <Input
                placeholder="Auto-derived"
                value={inputLocalWs}
                onChangeText={setInputLocalWs}
                autoCapitalize="none"
                autoCorrect={false}
                variant="secondary"
              />
            </View>
            <Button
              variant="primary"
              size="md"
              onPress={connectLocal}
              isDisabled={loading || !inputLocalHttp.trim()}
            >
              {loading ? <Spinner size="sm" color="#fff" /> : 'Connect'}
            </Button>
          </View>
        )}

        {error ? (
          <View className="rounded-md border border-red-200 p-3">
            <Text className="text-[13px] text-red-600">{error}</Text>
          </View>
        ) : null}

        {connected && hostId ? (
          <View className="flex-row items-center gap-2.5 rounded-md border border-green-200 p-3">
            <View className="w-2 h-2 rounded-full bg-green-500" />
            <View>
              <Text className="text-sm font-medium text-green-600">Connected</Text>
              <Text className="text-xs font-mono text-green-600">
                {hostId.slice(0, 8)}...
              </Text>
            </View>
          </View>
        ) : null}

        {connected && (
          <Pressable
            onPress={disconnect}
            className="rounded-md border border-red-200 p-3 items-center"
          >
            <Text className="text-sm font-medium text-red-600">Disconnect</Text>
          </Pressable>
        )}

        <View className="h-10" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
