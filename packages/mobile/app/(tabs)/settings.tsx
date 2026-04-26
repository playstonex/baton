import { StyleSheet, KeyboardAvoidingView, Platform, View, Text, Pressable, ScrollView } from 'react-native';
import { useState } from 'react';
import { Button, Input, Spinner } from 'heroui-native';
import { useConnectionStore } from '../../src/stores/connection';
import { wsService } from '../../src/services/websocket';
import { saveCredentials, clearCredentials } from '../../src/services/secure-storage';
import { useThemeStore, type ThemeMode } from '../../src/stores/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

const THEME_OPTIONS: { key: ThemeMode; label: string; desc: string }[] = [
  { key: 'system', label: 'System', desc: 'Follow device' },
  { key: 'light', label: 'Light', desc: 'Always light' },
  { key: 'dark', label: 'Dark', desc: 'Always dark' },
];

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
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.pageTitle, { color: c.textPrimary }]}>Settings</Text>

        <View style={[styles.section, { borderColor: c.cardBorder }]}>
          <Text style={[styles.sectionLabel, { color: c.textTertiary }]}>Appearance</Text>
          <View style={styles.optionRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setThemeMode(opt.key)}
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor: active ? '#eff6ff' : c.subtle,
                      borderColor: active ? '#2383e2' : c.cardBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: active ? '#1d4ed8' : c.textSecondary },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.section, { borderColor: c.cardBorder }]}>
          <Text style={[styles.sectionLabel, { color: c.textTertiary }]}>Connection</Text>
          <View style={styles.optionRow}>
            {(['local', 'remote'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor: active ? '#eff6ff' : c.subtle,
                      borderColor: active ? '#2383e2' : c.cardBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: active ? '#1d4ed8' : c.textSecondary },
                    ]}
                  >
                    {m === 'remote' ? 'Remote' : 'Local'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {mode === 'remote' ? (
          <View style={[styles.section, { borderColor: c.cardBorder }]}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Relay URL</Text>
              <Input
                placeholder="ws://host:3230"
                value={inputRelayUrl}
                onChangeText={setInputRelayUrl}
                autoCapitalize="none"
                autoCorrect={false}
                variant="secondary"
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>
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
          <View style={[styles.section, { borderColor: c.cardBorder }]}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>HTTP URL</Text>
              <Input
                placeholder="http://localhost:3210"
                value={inputLocalHttp}
                onChangeText={setInputLocalHttp}
                autoCapitalize="none"
                autoCorrect={false}
                variant="secondary"
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>
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
          <View style={[styles.errorBox, { borderColor: '#fecaca' }]}>
            <Text style={[styles.errorText, { color: '#dc2626' }]}>{error}</Text>
          </View>
        ) : null}

        {connected && hostId ? (
          <View style={[styles.successBox, { borderColor: '#bbf7d0' }]}>
            <View style={[styles.successDot, { backgroundColor: '#22c55e' }]} />
            <View>
              <Text style={[styles.successTitle, { color: '#16a34a' }]}>Connected</Text>
              <Text style={[styles.successId, { color: '#16a34a' }]}>
                {hostId.slice(0, 8)}...
              </Text>
            </View>
          </View>
        ) : null}

        {connected && (
          <Pressable
            onPress={disconnect}
            style={[styles.disconnectButton, { borderColor: '#fecaca' }]}
          >
            <Text style={[styles.disconnectText, { color: '#dc2626' }]}>Disconnect</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  pageTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
  section: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  errorBox: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
  },
  successDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  successId: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  disconnectButton: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
  },
  disconnectText: {
    fontSize: 14,
    fontWeight: '500',
  },
});