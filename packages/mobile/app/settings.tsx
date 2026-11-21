import { Platform, View, Text, Pressable, ScrollView, Linking, Share } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccessMode } from '@baton/shared';
import { useConnectionStore } from '../src/stores/connection';
import type { HostProfile } from '../src/services/secure-storage';
import { wsService } from '../src/services/websocket';
import {
  removeHost as persistRemoveHost,
  touchHost,
  hostToConnection,
} from '../src/services/secure-storage';
import { useThemeStore, type ThemeMode } from '../src/stores/theme';
import { useThemeColors } from '../src/hooks/useThemeColors';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { GroupedSection, GroupedRow } from '../src/components/GlassKit';
import { Typography, Spacing, Colors } from '../src/constants/theme';

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
    <View style={{ flex: 1, backgroundColor: c.groupedBg }}>
      <ScrollView
        // iOS insets under the large-title bar so the title collapses on scroll.
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: Spacing.lg,
          paddingTop: Platform.OS === 'ios' ? 0 : headerHeight,
          paddingBottom: (Platform.OS === 'ios' ? 0 : insets.bottom) + Spacing['3xl'],
        }}
      >
        <GroupedSection c={c} iconRows style={{ marginTop: Spacing.sm }}>
          <GroupedRow
            c={c}
            icon={connected ? 'checkmark' : 'alert'}
            iconColor={connected ? Colors.success[500] : Colors.danger[400]}
            title={activeHost?.label ?? 'Server'}
            subtitle={
              connected
                ? `Connected · ${activeHost?.mode ?? 'local'}${endpoint ? ` · ${endpoint}` : ''}`
                : 'Not connected — retrying'
            }
            accessory={
              connected && hostId ? (
                <Text style={[Typography.mono, { fontSize: 12, color: c.textTertiary }]}>
                  {hostId.slice(0, 8)}
                </Text>
              ) : undefined
            }
          />
        </GroupedSection>

        <GroupedSection
          c={c}
          iconRows
          header="Servers"
          footer={
            hosts.length > 0 ? 'Tap a server to switch to it. Swipe left to remove.' : undefined
          }
        >
          {hosts.map((host) => {
            const isActive = host.id === activeHostId;
            return (
              <Swipeable
                key={host.id}
                friction={2}
                rightThreshold={40}
                overshootRight={false}
                childrenContainerStyle={{ backgroundColor: c.card }}
                renderRightActions={(_progress, _translation, methods) => (
                  <Pressable
                    onPress={() => {
                      methods.close();
                      deleteHost(host);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${host.label}`}
                    style={{
                      width: 88,
                      backgroundColor: Colors.danger[500],
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={[Typography.subhead, { color: '#ffffff', fontWeight: '600' }]}>
                      Remove
                    </Text>
                  </Pressable>
                )}
              >
                <GroupedRow
                  c={c}
                  icon={host.mode === 'local' ? 'home' : 'globe'}
                  iconColor={host.mode === 'local' ? Colors.primary[500] : '#0a84ff'}
                  title={host.label}
                  subtitle={
                    isActive && connected
                      ? 'Connected'
                      : isActive
                        ? 'Last used server'
                        : formatTime(host.lastUsed)
                  }
                  selected={isActive}
                  onPress={isActive ? undefined : () => switchToHost(host)}
                  accessibilityHint={isActive ? undefined : 'Connects to this server'}
                />
              </Swipeable>
            );
          })}
          <GroupedRow
            c={c}
            icon="add"
            iconColor={c.isDark ? Colors.surface[600] : Colors.surface[400]}
            title="Add Server"
            onPress={() => router.push('/connect')}
          />
        </GroupedSection>

        {connected && (
          <GroupedSection
            c={c}
            header="Access Control"
            footer={
              accessMode === 'full-access'
                ? 'All tool executions are approved automatically. Use with caution.'
                : 'How agents handle permission requests.'
            }
          >
            <GroupedRow
              c={c}
              title="On Request"
              subtitle="Ask me each time"
              selected={accessMode === 'on-request'}
              onPress={() => setAccessMode('on-request')}
            />
            <GroupedRow
              c={c}
              title="Full Access"
              subtitle="Auto-approve all"
              selected={accessMode === 'full-access'}
              onPress={() => setAccessMode('full-access')}
            />
          </GroupedSection>
        )}

        <GroupedSection c={c} header="Appearance">
          {THEME_OPTIONS.map((opt) => (
            <GroupedRow
              key={opt.key}
              c={c}
              title={opt.label}
              selected={themeMode === opt.key}
              onPress={() => setThemeMode(opt.key)}
            />
          ))}
        </GroupedSection>

        <GroupedSection c={c} iconRows header="Contact Us">
          <GroupedRow
            c={c}
            icon="star"
            iconColor={Colors.warning[400]}
            title="给个好评"
            onPress={openAppStoreReview}
          />
          <GroupedRow
            c={c}
            icon="share"
            iconColor="#0a84ff"
            title="分享给好友"
            onPress={shareApp}
          />
        </GroupedSection>

        {Platform.OS === 'ios' && (
          <GroupedSection c={c} iconRows header="Subscriptions">
            <GroupedRow
              c={c}
              icon="card"
              iconColor={Colors.success[500]}
              title="管理订阅"
              onPress={openManageSubscriptions}
            />
          </GroupedSection>
        )}

        {connected && (
          <GroupedSection c={c}>
            <GroupedRow c={c} title="Disconnect" destructive onPress={disconnect} />
          </GroupedSection>
        )}
      </ScrollView>
      <OfflineBanner />
    </View>
  );
}
