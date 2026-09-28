import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useConnectionStore } from '../src/stores/connection';
import type { HostProfile } from '../src/services/secure-storage';
import { wsService } from '../src/services/websocket';
import {
  addHost as persistHost,
  removeHost as persistRemoveHost,
  touchHost,
  hostToConnection,
} from '../src/services/secure-storage';
import { useThemeColors } from '../src/hooks/useThemeColors';
import {
  GlassCard,
  GlassSectionHeader,
  GlassButton,
  GlassDivider,
  GlassPill,
} from '../src/components/GlassKit';
import { Typography, Spacing, Colors } from '../src/constants/theme';
import { QrScannerModal, type ScannedPairingData } from '../src/components/QrScannerModal';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const inputStyle = (c: ReturnType<typeof useThemeColors>) => ({
  backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
  borderWidth: 1,
  borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
  borderRadius: 12,
  paddingVertical: Spacing.md,
  paddingHorizontal: Spacing.md,
  color: c.textPrimary,
  ...Typography.subhead,
  fontWeight: '500' as const,
});

/**
 * Connection-first entry screen: pick a recently used server with one tap,
 * or enter a manual local/remote configuration. Connecting navigates to the
 * main tabs; it is also the landing screen when no server has been saved yet.
 */
export default function ConnectScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  const connected = useConnectionStore((s) => s.connected);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const hosts = useConnectionStore((s) => s.hosts);
  const activeHostId = useConnectionStore((s) => s.activeHostId);
  const addHost = useConnectionStore((s) => s.addHost);
  const removeHost = useConnectionStore((s) => s.removeHost);
  const setHosts = useConnectionStore((s) => s.setHosts);
  const setActiveHost = useConnectionStore((s) => s.setActiveHost);

  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [inputLocalHttp, setInputLocalHttp] = useState('');
  const [inputLocalWs, setInputLocalWs] = useState('');
  const [inputRelayUrl, setInputRelayUrl] = useState('');
  const [inputPairingCode, setInputPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);

  /**
   * A QR code is untrusted input: anyone can show one. Validate the URL schemes
   * and make the user confirm the exact host before we persist it, connect, or
   * send a pairing code anywhere.
   */
  function handleScanResult(data: ScannedPairingData) {
    const target = data.localHttpUrl ?? data.relayUrl;
    if (!target) {
      setError('QR code does not contain a Baton host address');
      return;
    }
    const scheme = data.localHttpUrl ? /^https?:\/\//i : /^wss?:\/\//i;
    let hostLabel: string;
    try {
      if (!scheme.test(target)) throw new Error('bad scheme');
      hostLabel = new URL(target).host;
    } catch {
      setError(`Unsupported address in QR code: ${target}`);
      return;
    }
    const lines = [
      data.name ? `Name: ${data.name}` : null,
      `Host: ${hostLabel}`,
      data.fingerprint ? `Fingerprint: ${data.fingerprint}` : null,
      '',
      'Only continue if this matches the host shown on your computer.',
    ].filter((l): l is string => l !== null);
    Alert.alert('Connect to this host?', lines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Connect', onPress: () => void applyScanResult(data) },
    ]);
  }

  async function applyScanResult(data: ScannedPairingData) {
    if (data.localHttpUrl) {
      setMode('local');
      setInputLocalHttp(data.localHttpUrl);
      const wsUrl =
        data.localWsUrl ||
        data.localHttpUrl.replace(/^http/, 'ws').replace(/:\d+$/, ':3211');
      setInputLocalWs(wsUrl);
      setLoading(true);
      setError('');
      try {
        const config = {
          mode: 'local' as const,
          localHttpUrl: data.localHttpUrl,
          localWsUrl: wsUrl,
        };
        const host = await persistHost(config);
        addHost(host);
        wsService.configure(config);
        wsService.connect();
        pendingNavigation.current = true;
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (data.relayUrl) {
      setMode('remote');
      setInputRelayUrl(data.relayUrl);
      if (data.pairingCode) {
        setInputPairingCode(data.pairingCode);
        setLoading(true);
        setError('');
        try {
          const gatewayUrl = data.relayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3220');
          const res = await fetch(`${gatewayUrl}/api/v1/auth/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: data.pairingCode.trim() }),
          });
          const authData = (await res.json()) as { token?: string; hostId?: string; error?: string };
          if (!res.ok) {
            setError(authData.error ?? 'Pairing failed');
            return;
          }
          const config = {
            mode: 'remote' as const,
            relayUrl: data.relayUrl.trim(),
            hostId: authData.hostId,
            token: authData.token,
          };
          const host = await persistHost(config);
          addHost(host);
          wsService.configure(config);
          wsService.connect();
          pendingNavigation.current = true;
        } catch (err) {
          setError(`Connection failed: ${err}`);
        } finally {
          setLoading(false);
        }
      }
    }
  }

  // Only auto-advance to the tabs for a connection this screen initiated —
  // arriving here from Settings while already connected must not bounce back.
  const pendingNavigation = useRef(false);

  useEffect(() => {
    if (connected && pendingNavigation.current) {
      pendingNavigation.current = false;
      router.replace('/(tabs)');
    }
  }, [connected, router]);

  const sortedHosts = [...hosts].sort((a, b) => b.lastUsed - a.lastUsed);
  const activeHost = hosts.find((h) => h.id === activeHostId);

  /** Connect to an already-saved server. */
  async function connectToHost(host: HostProfile) {
    setError('');
    pendingNavigation.current = true;
    const updatedHosts = await touchHost(host.id);
    setHosts(updatedHosts);
    setActiveHost(host.id);
    wsService.configure(hostToConnection(host));
    wsService.connect();
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
    wsService.configure(config);
    wsService.connect();
    pendingNavigation.current = true;
    setLoading(false);
  }

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
      const host = await persistHost(config);
      addHost(host);
      wsService.configure(config);
      wsService.connect();
      pendingNavigation.current = true;
      setInputPairingCode('');
    } catch (err) {
      setError(`Connection failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteHost(host: HostProfile) {
    await persistRemoveHost(host.id);
    removeHost(host.id);
    if (host.id === activeHostId) {
      wsService.disconnect();
      setConnected(false);
    }
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
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Entry screen after a redirect has nothing to go back to; when
            pushed from Settings (Add Server), show a back affordance. */}
        {router.canGoBack() && (
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ marginBottom: Spacing.xs }}
          >
            <Ionicons name="chevron-back" size={26} color={c.textPrimary} />
          </Pressable>
        )}

        <View style={{ marginBottom: Spacing.sm }}>
          <Text style={[Typography.largeTitle, { color: c.textPrimary }]}>Connect</Text>
          <Text style={[Typography.footnote, { color: c.textSecondary, marginTop: 4 }]}>
            Pick a server or add a new one to start controlling your agents.
          </Text>
        </View>

        {connected && activeHost && (
          <Pressable onPress={() => router.replace('/(tabs)')}>
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
                <View style={{ flex: 1 }}>
                  <Text
                    style={[Typography.monoSemiBold, { color: Colors.success[400], fontSize: 14 }]}
                    numberOfLines={1}
                  >
                    {activeHost.label}
                  </Text>
                  <Text style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}>
                    Connected — tap to open the dashboard
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
              </View>
            </GlassCard>
          </Pressable>
        )}

        {sortedHosts.length > 0 && (
          <>
            <GlassSectionHeader c={c} title="Recent Servers" />
            <GlassCard c={c} style={{ padding: 0 }}>
              {sortedHosts.map((host, i) => {
                const isActive = host.id === activeHostId;
                return (
                  <View key={host.id}>
                    <Pressable
                      onPress={() => connectToHost(host)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 10,
                        paddingHorizontal: Spacing.lg,
                        gap: Spacing.sm,
                        opacity: pressed ? 0.7 : 1,
                      })}
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
                        <Text
                          style={[Typography.caption2, { color: c.textTertiary, marginTop: 2 }]}
                        >
                          {isActive && connected
                            ? 'Connected'
                            : isActive
                              ? 'Last used server'
                              : formatTime(host.lastUsed)}
                        </Text>
                      </View>
                      {isActive && connected && (
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: Colors.success[400],
                          }}
                        />
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
                    </Pressable>
                    {i < sortedHosts.length - 1 && <GlassDivider c={c} />}
                  </View>
                );
              })}
            </GlassCard>
          </>
        )}

        <GlassSectionHeader c={c} title="New Server" />
        <Pressable
          onPress={() => setScannerVisible(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Spacing.sm,
            paddingVertical: 14,
            paddingHorizontal: Spacing.lg,
            borderRadius: 14,
            backgroundColor: c.isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)',
            borderWidth: 1,
            borderColor: 'rgba(59, 130, 246, 0.3)',
            opacity: pressed ? 0.8 : 1,
            marginBottom: Spacing.xs,
          })}
        >
          <Ionicons name="qr-code-outline" size={20} color={Colors.primary[500]} />
          <Text style={[Typography.subhead, { color: Colors.primary[500], fontWeight: '600' }]}>
            Scan Pairing QR Code
          </Text>
        </Pressable>
        <GlassCard c={c} style={{ gap: Spacing.md }}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {(['local', 'remote'] as const).map((m) => (
              <GlassPill
                key={m}
                c={c}
                label={m === 'remote' ? 'Remote (Relay)' : 'Local (Wi-Fi)'}
                active={mode === m}
                onPress={() => setMode(m)}
              />
            ))}
          </View>

          {mode === 'local' ? (
            <>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>HTTP URL</Text>
                <TextInput
                  placeholder="http://192.168.1.10:3210"
                  value={inputLocalHttp}
                  onChangeText={setInputLocalHttp}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholderTextColor={c.textTertiary}
                  style={inputStyle(c)}
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
                  keyboardType="url"
                  placeholderTextColor={c.textTertiary}
                  style={inputStyle(c)}
                />
              </View>
              <GlassButton
                c={c}
                label={loading ? '' : 'Connect'}
                onPress={connectLocal}
                loading={loading}
                disabled={loading || !inputLocalHttp.trim()}
                variant="primary"
              />
            </>
          ) : (
            <>
              <View style={{ gap: 6 }}>
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>Relay URL</Text>
                <TextInput
                  placeholder="ws://host:3230"
                  value={inputRelayUrl}
                  onChangeText={setInputRelayUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholderTextColor={c.textTertiary}
                  style={inputStyle(c)}
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
                  placeholderTextColor={c.textTertiary}
                  style={inputStyle(c)}
                />
              </View>
              <GlassButton
                c={c}
                label={loading ? '' : 'Pair & Connect'}
                onPress={pairAndConnect}
                loading={loading}
                disabled={loading || !inputRelayUrl.trim() || inputPairingCode.length < 6}
                variant="primary"
              />
            </>
          )}

          {error ? (
            <Text style={[Typography.footnote, { color: Colors.danger[400] }]}>{error}</Text>
          ) : null}
        </GlassCard>

        {sortedHosts.length === 0 && (
          <Text style={[Typography.caption2, { color: c.textTertiary, textAlign: 'center' }]}>
            No saved servers yet — connect once and it will appear here.
          </Text>
        )}
      </ScrollView>

      <QrScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={handleScanResult}
      />
    </KeyboardAvoidingView>
  );
}
