import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Linking,
  Share,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccessMode } from '@baton/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useConnectionStore } from '../../src/stores/connection';
import type { HostProfile } from '../../src/services/secure-storage';
import { wsService } from '../../src/services/websocket';
import {
  removeHost as persistRemoveHost,
  touchHost,
  hostToConnection,
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
  const router = useRouter();
  const hostId = useConnectionStore((s) => s.hostId);
  const connected = useConnectionStore((s) => s.connected);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const hosts = useConnectionStore((s) => s.hosts);
  const activeHostId = useConnectionStore((s) => s.activeHostId);
  const removeHost = useConnectionStore((s) => s.removeHost);
  const setHosts = useConnectionStore((s) => s.setHosts);
  const setActiveHost = useConnectionStore((s) => s.setActiveHost);

  const activeHost = useConnectionStore(
    (s) => s.hosts.find((h) => h.id === s.activeHostId) ?? null,
  );

  const themeMode = useThemeStore((s) => s.theme);
  const setThemeMode = useThemeStore((s) => s.setTheme);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  const [accessMode, setAccessModeState] = useState<AccessMode>('on-request');

  /** Switch to an already-paired host: mark active, configure WS, reconnect. */
  async function switchToHost(host: HostProfile) {
    const updatedHosts = await touchHost(host.id);
    setHosts(updatedHosts);
    setActiveHost(host.id);
    wsService.configure(hostToConnection(host));
    wsService.connect();
  }

  async function deleteHost(host: HostProfile) {
    await persistRemoveHost(host.id);
    removeHost(host.id);
    // If we just removed the active host, drop the connection. With no
    // servers left, return to the connection-first entry screen.
    if (activeHostId === host.id) {
      wsService.disconnect();
      setConnected(false);
    }
    if (hosts.length <= 1) {
      router.replace('/connect');
    }
  }

  /** Disconnect but keep saved servers; the connect screen takes over. */
  function disconnect() {
    wsService.disconnect();
    setConnected(false);
    router.replace('/connect');
  }

  /** Hostname-only endpoint for the summary card (no credentials in URLs). */
  const endpoint = (() => {
    const url = activeHost?.mode === 'local' ? activeHost.localHttpUrl : activeHost?.relayUrl;
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();

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

        {/* Live connection summary — connection first, mirroring web settings v2 */}
        <GlassCard c={c}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: connected ? 'rgba(63,185,80,0.15)' : 'rgba(235,77,85,0.15)',
              }}
            >
              <Ionicons
                name={connected ? 'checkmark' : 'alert-circle-outline'}
                size={18}
                color={connected ? Colors.success[400] : Colors.danger[400]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}
                numberOfLines={1}
              >
                {activeHost?.label ?? 'Server'}
              </Text>
              <Text
                style={[Typography.caption1, { color: c.textTertiary, marginTop: 1 }]}
                numberOfLines={1}
              >
                {connected
                  ? `Connected · ${activeHost?.mode ?? 'local'}${endpoint ? ` · ${endpoint}` : ''}`
                  : 'Not connected — retrying'}
              </Text>
            </View>
            {connected && hostId ? (
              <View
                style={{
                  flexShrink: 0,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.cardBorder,
                  backgroundColor: c.isDark ? 'rgba(255,255,255,0.04)' : c.elevated,
                  borderRadius: 7,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={[Typography.mono, { fontSize: 10, color: c.textTertiary }]}>
                  {hostId.slice(0, 8)}…
                </Text>
              </View>
            ) : null}
          </View>
        </GlassCard>

        <GlassSectionHeader c={c} title="Servers" />
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
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                    }}
                  >
                    <Ionicons
                      name={host.mode === 'local' ? 'home-outline' : 'globe-outline'}
                      size={18}
                      color={Colors.primary[500]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[Typography.mono, { color: c.textPrimary, fontSize: 13 }]}
                      numberOfLines={1}
                    >
                      {host.label}
                    </Text>
                    <Text style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}>
                      {isActive && connected
                        ? 'Connected'
                        : isActive
                          ? 'Last used server'
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
          <View style={{ padding: Spacing.md }}>
            <GlassButton
              c={c}
              label="Add Server"
              icon="add"
              onPress={() => router.push('/connect')}
              variant="secondary"
            />
          </View>
        </GlassCard>

        {connected && (
          <GlassButton c={c} label="Disconnect" onPress={disconnect} variant="danger" />
        )}

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
