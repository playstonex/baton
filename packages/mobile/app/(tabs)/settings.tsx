import { KeyboardAvoidingView, Platform, View, Text, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccessMode } from '@baton/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useConnectionStore } from '../../src/stores/connection';
import { useRecentStore } from '../../src/stores/recent';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';
import { useThemeStore, type ThemeMode } from '../../src/stores/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useLayoutStore } from '../../src/stores/layout';
import {
  GlassCard,
  GlassSectionHeader,
  GlassButton,
  GlassDivider,
  GlassPill,
} from '../../src/components/GlassKit';
import {
  Typography,
  Spacing,
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
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  const [inputRelayUrl, setInputRelayUrl] = useState(relayUrl);
  const [inputPairingCode, setInputPairingCode] = useState('');
  const [inputLocalHttp, setInputLocalHttp] = useState(localHttpUrl);
  const [inputLocalWs, setInputLocalWs] = useState(localWsUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accessMode, setAccessModeState] = useState<AccessMode>('on-request');

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

  function setAccessMode(mode: AccessMode) {
    setAccessModeState(mode);
    wsService.send({
      type: 'control',
      action: 'set_access_mode',
      payload: { mode },
    });
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + tabBarHeight + Spacing.lg, gap: Spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[Typography.largeTitle, { color: c.textPrimary, marginBottom: Spacing.lg }]}>
          Settings
        </Text>

        <GlassSectionHeader c={c} title="Appearance" />
        <GlassCard c={c}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {THEME_OPTIONS.map((opt) => (
              <GlassPill
                key={opt.key}
                c={c}
                label={opt.label}
                active={themeMode === opt.key}
                onPress={() => setThemeMode(opt.key)}
              />
            ))}
          </View>
        </GlassCard>

        <GlassSectionHeader c={c} title="Connection" />
        <GlassCard c={c}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {(['local', 'remote'] as const).map((m) => (
              <GlassPill
                key={m}
                c={c}
                label={m === 'remote' ? 'Remote' : 'Local'}
                active={mode === m}
                onPress={() => setMode(m)}
              />
            ))}
          </View>
        </GlassCard>

        {connected && (
          <>
            <GlassSectionHeader c={c} title="Access Control" />
            <GlassCard c={c}>
              <Text style={[Typography.footnote, { color: c.textSecondary }]}>
                How agents handle permission requests
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                {([
                  { key: 'on-request' as const, label: 'On Request', desc: 'Ask me each time' },
                  { key: 'full-access' as const, label: 'Full Access', desc: 'Auto-approve all' },
                ] as const).map((opt) => {
                  const active = accessMode === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setAccessMode(opt.key)}
                      style={{
                        flex: 1,
                        minHeight: 60,
                        borderRadius: 12,
                        borderWidth: 1,
                        paddingVertical: Spacing.md,
                        paddingHorizontal: Spacing.sm,
                        backgroundColor: active ? c.accentBg : c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                        borderColor: active ? c.accentBorder : c.cardBorder,
                      }}
                    >
                      <Text
                        style={[
                          Typography.subhead,
                          { color: active ? Colors.primary[500] : c.textPrimary, fontWeight: '600' },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}>
                        {opt.desc}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {accessMode === 'full-access' && (
                <View
                  style={{
                    backgroundColor: c.dangerBg,
                    borderRadius: 10,
                    padding: Spacing.sm,
                    marginTop: Spacing.xs,
                  }}
                >
                  <Text style={[Typography.caption1, { color: Colors.danger[400] }]}>
                    All tool executions will be automatically approved. Use with caution.
                  </Text>
                </View>
              )}
            </GlassCard>
          </>
        )}

        {recentConnections.length > 0 && (
          <>
            <GlassSectionHeader c={c} title="Recent Connections" />
            <GlassCard c={c} style={{ padding: 0 }}>
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
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 18 }}>
                      {conn.mode === 'local' ? '\u{1F3E0}' : '\u{1F310}'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[Typography.subhead, { color: c.textPrimary }]} numberOfLines={1}>
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
                        width: 28, height: 28, borderRadius: 12,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="close" size={14} color={c.textTertiary} />
                    </Pressable>
                  </Pressable>
                  {i < recentConnections.length - 1 && <GlassDivider c={c} />}
                </View>
              ))}
            </GlassCard>
          </>
        )}

        {mode === 'remote' ? (
          <>
            <GlassSectionHeader c={c} title="Remote Setup" />
            <GlassCard c={c}>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>Relay URL</Text>
                <TextInput
                  placeholder="ws://host:3230"
                  value={inputRelayUrl}
                  onChangeText={setInputRelayUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  readOnly={connected}
                  placeholderTextColor={c.textTertiary}
                  style={{
                    backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                    borderWidth: 1,
                    borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                    borderRadius: 12,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.md,
                    color: c.textPrimary,
                    ...Typography.subhead,
                    fontWeight: '500',
                  }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>
                  Pairing Code ({inputPairingCode.length}/6)
                </Text>
                <TextInput
                  placeholder="000000"
                  value={inputPairingCode}
                  onChangeText={setInputPairingCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  readOnly={connected}
                  placeholderTextColor={c.textTertiary}
                  style={{
                    backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                    borderWidth: 1,
                    borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                    borderRadius: 12,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.md,
                    color: c.textPrimary,
                    ...Typography.subhead,
                    fontWeight: '500',
                  }}
                />
              </View>
              {!connected && (
                <GlassButton
                  c={c}
                  label={loading ? '' : 'Pair & Connect'}
                  onPress={pairAndConnect}
                  loading={loading}
                  disabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
                  variant="primary"
                />
              )}
            </GlassCard>
          </>
        ) : (
          <>
            <GlassSectionHeader c={c} title="Local Setup" />
            <GlassCard c={c}>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>HTTP URL</Text>
                <TextInput
                  placeholder="http://localhost:3210"
                  value={inputLocalHttp}
                  onChangeText={setInputLocalHttp}
                  autoCapitalize="none"
                  autoCorrect={false}
                  readOnly={connected}
                  placeholderTextColor={c.textTertiary}
                  style={{
                    backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                    borderWidth: 1,
                    borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                    borderRadius: 12,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.md,
                    color: c.textPrimary,
                    ...Typography.subhead,
                    fontWeight: '500',
                  }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>
                  WebSocket URL (optional)
                </Text>
                <TextInput
                  placeholder="Auto-derived"
                  value={inputLocalWs}
                  onChangeText={setInputLocalWs}
                  autoCapitalize="none"
                  autoCorrect={false}
                  readOnly={connected}
                  placeholderTextColor={c.textTertiary}
                  style={{
                    backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                    borderWidth: 1,
                    borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                    borderRadius: 12,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.md,
                    color: c.textPrimary,
                    ...Typography.subhead,
                    fontWeight: '500',
                  }}
                />
              </View>
              {!connected && (
                <GlassButton
                  c={c}
                  label={loading ? '' : 'Connect'}
                  onPress={connectLocal}
                  loading={loading}
                  disabled={loading || !inputLocalHttp.trim()}
                  variant="primary"
                />
              )}
            </GlassCard>
          </>
        )}

        {error ? (
          <GlassCard c={c}>
            <Text style={[Typography.footnote, { color: Colors.danger[400] }]}>{error}</Text>
          </GlassCard>
        ) : null}

        {connected && hostId ? (
          <GlassCard c={c}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success[400] }} />
              <View>
                <Text style={[Typography.subhead, { color: Colors.success[400], fontWeight: '600' }]}>
                  Connected
                </Text>
                <Text style={[Typography.caption1, { color: Colors.success[400], fontFamily: 'Courier' }]}>
                  {hostId.slice(0, 8)}...
                </Text>
              </View>
            </View>
          </GlassCard>
        ) : null}

        {connected && (
          <GlassButton
            c={c}
            label="Disconnect"
            onPress={disconnect}
            variant="danger"
          />
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
