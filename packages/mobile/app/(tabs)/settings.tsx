import { KeyboardAvoidingView, Platform, View, Text, Pressable, ScrollView } from 'react-native';
import { useState } from 'react';
import { Button, Input, Spinner } from 'heroui-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectionStore } from '../../src/stores/connection';
import { useRecentStore } from '../../src/stores/recent';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';
import { useThemeStore, type ThemeMode } from '../../src/stores/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import {
  Typography,
  Spacing,
  CornerRadius,
  Colors,
} from '../../src/constants/theme';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
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
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

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
        contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100, gap: Spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[Typography.largeTitle, { color: c.textPrimary, marginBottom: Spacing.lg }]}>
          Settings
        </Text>

        <Text
          style={[
            Typography.caption1,
            { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
          ]}
        >
          Appearance
        </Text>
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: CornerRadius.large,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setThemeMode(opt.key)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: CornerRadius.medium,
                    borderWidth: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? c.accentBg : c.elevated,
                    borderColor: active ? c.accentBorder : c.cardBorder,
                  }}
                >
                  <Text
                    style={[
                      Typography.subhead,
                      { color: active ? Colors.primary[500] : c.textSecondary },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text
          style={[
            Typography.caption1,
            { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
          ]}
        >
          Connection
        </Text>
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: CornerRadius.large,
            padding: Spacing.lg,
            gap: Spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {(['local', 'remote'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: CornerRadius.medium,
                    borderWidth: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? c.accentBg : c.elevated,
                    borderColor: active ? c.accentBorder : c.cardBorder,
                  }}
                >
                  <Text
                    style={[
                      Typography.subhead,
                      { color: active ? Colors.primary[500] : c.textSecondary },
                    ]}
                  >
                    {m === 'remote' ? 'Remote' : 'Local'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {recentConnections.length > 0 && (
          <>
            <Text
              style={[
                Typography.caption1,
                { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
              ]}
            >
              Recent Connections
            </Text>
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: CornerRadius.large,
                overflow: 'hidden',
              }}
            >
              {recentConnections.map((conn, i) => (
                <View key={i}>
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
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: Spacing.lg,
                      gap: Spacing.sm,
                      backgroundColor: pressed ? c.subtle : c.card,
                    })}
                  >
                    <Text style={{ fontSize: 18 }}>
                      {conn.mode === 'local' ? '🏠' : '🌐'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[Typography.subhead, { color: c.textPrimary }]}
                        numberOfLines={1}
                      >
                        {conn.label}
                      </Text>
                      <Text style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}>
                        {formatTime(conn.lastUsed)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeRecentConnection(i)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: CornerRadius.medium,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={[Typography.footnote, { color: c.textTertiary }]}>✕</Text>
                    </Pressable>
                  </Pressable>
                  {i < recentConnections.length - 1 && (
                    <View
                      style={{
                        height: 1,
                        backgroundColor: c.separator,
                        marginLeft: Spacing.lg + 28 + Spacing.sm,
                      }}
                    />
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {mode === 'remote' ? (
          <>
            <Text
              style={[
                Typography.caption1,
                { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
              ]}
            >
              Remote Setup
            </Text>
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: CornerRadius.large,
                padding: Spacing.lg,
                gap: Spacing.md,
              }}
            >
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>Relay URL</Text>
                <Input
                  placeholder="ws://host:3230"
                  value={inputRelayUrl}
                  onChangeText={setInputRelayUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  variant="secondary"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>
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
              <Pressable
                onPress={pairAndConnect}
                disabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
                style={{
                  minHeight: 44,
                  borderRadius: CornerRadius.medium,
                  backgroundColor:
                    loading || !inputRelayUrl.trim() || inputPairingCode.length < 6
                      ? Colors.primary[500] + '40'
                      : Colors.primary[500],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {loading ? (
                  <Spinner size="sm" color="#fff" />
                ) : (
                  <Text
                    style={[
                      Typography.subhead,
                      { color: '#FFFFFF', fontWeight: '600' },
                    ]}
                  >
                    Pair &amp; Connect
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text
              style={[
                Typography.caption1,
                { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
              ]}
            >
              Local Setup
            </Text>
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: CornerRadius.large,
                padding: Spacing.lg,
                gap: Spacing.md,
              }}
            >
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>HTTP URL</Text>
                <Input
                  placeholder="http://localhost:3210"
                  value={inputLocalHttp}
                  onChangeText={setInputLocalHttp}
                  autoCapitalize="none"
                  autoCorrect={false}
                  variant="secondary"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>
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
              <Pressable
                onPress={connectLocal}
                disabled={loading || !inputLocalHttp.trim()}
                style={{
                  minHeight: 44,
                  borderRadius: CornerRadius.medium,
                  backgroundColor:
                    loading || !inputLocalHttp.trim()
                      ? Colors.primary[500] + '40'
                      : Colors.primary[500],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {loading ? (
                  <Spinner size="sm" color="#fff" />
                ) : (
                  <Text
                    style={[
                      Typography.subhead,
                      { color: '#FFFFFF', fontWeight: '600' },
                    ]}
                  >
                    Connect
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        )}

        {error ? (
          <View
            style={{
              backgroundColor: c.dangerBg,
              borderRadius: CornerRadius.medium,
              padding: Spacing.md,
            }}
          >
            <Text style={[Typography.footnote, { color: Colors.danger[400] }]}>{error}</Text>
          </View>
        ) : null}

        {connected && hostId ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.sm,
              backgroundColor: c.successBg,
              borderRadius: CornerRadius.medium,
              paddingVertical: 10,
              paddingHorizontal: Spacing.md,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: Colors.success[400],
              }}
            />
            <View>
              <Text style={[Typography.subhead, { color: Colors.success[400], fontWeight: '600' }]}>
                Connected
              </Text>
              <Text
                style={[
                  Typography.caption1,
                  { color: Colors.success[400], fontFamily: 'Courier' },
                ]}
              >
                {hostId.slice(0, 8)}...
              </Text>
            </View>
          </View>
        ) : null}

        {connected && (
          <Pressable
            onPress={disconnect}
            style={{
              minHeight: 44,
              borderRadius: CornerRadius.medium,
              backgroundColor: c.dangerBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[Typography.subhead, { color: Colors.danger[400], fontWeight: '600' }]}>
              Disconnect
            </Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
