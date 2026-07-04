import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Linking,
  Share,
} from 'react-native';
import { useState } from 'react';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccessMode } from '@baton/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useConnectionStore } from '../../src/stores/connection';
import type { HostProfile } from '../../src/services/secure-storage';
import { useRecentStore } from '../../src/stores/recent';
import { wsService } from '../../src/services/websocket';
import {
  addHost as persistHost,
  removeHost as persistRemoveHost,
  hostToConnection,
  clearCredentials,
} from '../../src/services/secure-storage';
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
import { Typography, Spacing, Colors } from '../../src/constants/theme';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/**
 * App Store identifiers for Baton (com.playstone.baton).
 * Used to build App Store review / share / manage-subscription deep links.
 */
const APP_STORE_ID = '6763741376';
const BUNDLE_ID = 'com.playstone.baton';
const APP_STORE_WEB_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
const APP_STORE_REVIEW_URL =
  Platform.OS === 'ios'
    ? `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`
    : `market://details?id=${BUNDLE_ID}`;

function openAppStoreReview() {
  Linking.openURL(APP_STORE_REVIEW_URL).catch(() => {
    Linking.openURL(APP_STORE_WEB_URL).catch(() => {});
  });
}

/** Deep-link to the system subscription management page (App Store → subscriptions). */
function openManageSubscriptions() {
  if (Platform.OS !== 'ios') return;
  Linking.openURL('itms-apps://apps.apple.com/account/subscriptions').catch(() => {});
}

/** Open the native share sheet to share the app link. */
function shareApp() {
  const message = 'Check out Baton — control coding agents from your phone.\n' + APP_STORE_WEB_URL;
  Share.share({ message }).catch(() => {});
}

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
  const hosts = useConnectionStore((s) => s.hosts);
  const activeHostId = useConnectionStore((s) => s.activeHostId);
  const addHost = useConnectionStore((s) => s.addHost);
  const removeHost = useConnectionStore((s) => s.removeHost);

  const recentConnections = useRecentStore((s) => s.connections);
  const addRecentConnection = useRecentStore((s) => s.addConnection);

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
      const gatewayUrl = inputRelayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3220');
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
      const host = await persistHost(config);
      addHost(host);
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
    const host = await persistHost(config);
    addHost(host);
    addRecentConnection(config);
    wsService.configure(config);
    wsService.connect();
    setLoading(false);
  }

  /** Switch to an already-paired host: configure WS and reconnect. */
  function switchToHost(host: HostProfile) {
    const config = hostToConnection(host);
    setCredentials(config);
    wsService.configure(config);
    wsService.connect();
  }

  async function deleteHost(host: HostProfile) {
    await persistRemoveHost(host.id);
    removeHost(host.id);
    // If we just removed the active host, clear the connection.
    if (activeHostId === host.id) {
      wsService.disconnect();
      setConnected(false);
      if (hosts.length <= 1) {
        await clearCredentials();
      }
    }
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
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + tabBarHeight + Spacing.lg,
          gap: Spacing.md,
        }}
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
                {(
                  [
                    { key: 'on-request' as const, label: 'On Request', desc: 'Ask me each time' },
                    { key: 'full-access' as const, label: 'Full Access', desc: 'Auto-approve all' },
                  ] as const
                ).map((opt) => {
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
                        backgroundColor: active
                          ? c.accentBg
                          : c.isDark
                            ? 'rgba(58,58,60,0.55)'
                            : c.elevated,
                        borderColor: active ? c.accentBorder : c.cardBorder,
                      }}
                    >
                      <Text
                        style={[
                          Typography.subhead,
                          {
                            color: active ? Colors.primary[500] : c.textPrimary,
                            fontWeight: '600',
                          },
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

        {hosts.length > 0 && (
          <>
            <GlassSectionHeader c={c} title="Hosts" />
            <GlassCard c={c} style={{ padding: 0 }}>
              {hosts.map((host, i) => {
                const isActive = host.id === activeHostId;
                return (
                  <View key={host.id}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 10,
                        paddingHorizontal: Spacing.lg,
                        gap: Spacing.sm,
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>
                        {host.mode === 'local' ? '\u{1F3E0}' : '\u{1F310}'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[Typography.subhead, { color: c.textPrimary }]}
                          numberOfLines={1}
                        >
                          {host.label}
                        </Text>
                        <Text
                          style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}
                        >
                          {isActive && connected
                            ? 'Connected'
                            : isActive
                              ? 'Active'
                              : formatTime(host.lastUsed)}
                        </Text>
                      </View>
                      {!isActive && (
                        <Pressable
                          onPress={() => switchToHost(host)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 12,
                            backgroundColor: c.accentBg,
                            borderWidth: 1,
                            borderColor: c.accentBorder,
                          }}
                        >
                          <Text
                            style={[
                              Typography.caption2,
                              { color: Colors.primary[500], fontWeight: '600' },
                            ]}
                          >
                            Connect
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => deleteHost(host)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="close" size={14} color={c.textTertiary} />
                      </Pressable>
                    </View>
                    {i < hosts.length - 1 && <GlassDivider c={c} />}
                  </View>
                );
              })}
            </GlassCard>
          </>
        )}

        {recentConnections.length > 0 && hosts.length === 0 && (
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
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: Colors.success[400],
                }}
              />
              <View>
                <Text
                  style={[Typography.subhead, { color: Colors.success[400], fontWeight: '600' }]}
                >
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
          </GlassCard>
        ) : null}

        {connected && (
          <GlassButton c={c} label="Disconnect" onPress={disconnect} variant="danger" />
        )}

        <GlassSectionHeader c={c} title="About" />
        <GlassCard c={c} style={{ padding: 0 }}>
          <Text
            style={[
              Typography.caption2,
              {
                color: c.textTertiary,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                paddingHorizontal: Spacing.lg,
                paddingTop: Spacing.md,
                paddingBottom: Spacing.xs,
              },
            ]}
          >
            Contact Us
          </Text>

          <AboutRow icon="star-outline" label="给个好评" onPress={openAppStoreReview} colors={c} />
          <AboutRow icon="share-outline" label="分享给好友" onPress={shareApp} colors={c} />

          <Text
            style={[
              Typography.caption2,
              {
                color: c.textTertiary,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                paddingHorizontal: Spacing.lg,
                paddingTop: Spacing.md,
                paddingBottom: Spacing.xs,
              },
            ]}
          >
            Subscriptions
          </Text>

          <AboutRow
            icon="card-outline"
            label="管理订阅"
            onPress={openManageSubscriptions}
            colors={c}
          />
        </GlassCard>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AboutRow({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon as any} size={20} color={colors.textSecondary} />
      <Text style={[Typography.subhead, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}
