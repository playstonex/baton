import { StyleSheet, KeyboardAvoidingView, Platform, TextInput } from 'react-native';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { wsService } from '../../src/services/websocket';
import { STATUS_COLORS, Colors } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { XtermWebView, type XtermWebViewRef } from '../../src/components/XtermWebView';

const SHORTCUT_KEYS: { label: string; data: string }[] = [
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '/', data: '/' },
  { label: '~', data: '~' },
];

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const xtermRef = useRef<XtermWebViewRef>(null);
  const textInputRef = useRef<TextInput>(null);
  const [status, setStatus] = useState('running');
  const [xtermStatus, setXtermStatus] = useState<string>('loading...');
  const [wsConnected, setWsConnected] = useState(wsService.connected);
  const [inputText, setInputText] = useState('');
  const c = useThemeColors();

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      wsService.send({
        type: 'control',
        action: 'resize',
        sessionId,
        payload: { cols, rows },
      });
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;

    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        xtermRef.current?.write(msg.data);
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && msg.sessionId === sessionId && 'status' in msg) {
        setStatus(msg.status as string);
      }
    });

    const unsubState = wsService.on('_state', () => {
      setWsConnected(wsService.connected);
    });

    const unsubError = wsService.on('error', (msg) => {
      if ('message' in msg) {
        xtermRef.current?.write(`\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
      }
    });

    return () => {
      unsubOutput();
      unsubStatus();
      unsubState();
      unsubError();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !wsConnected) return;

    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    return () => {
      wsService.send({ type: 'control', action: 'detach_session', sessionId });
    };
  }, [sessionId, wsConnected]);

  const handleInput = useCallback(
    (data: string) => {
      if (!sessionId || !wsService.connected) return;
      wsService.send({ type: 'terminal_input', sessionId, data });
    },
    [sessionId],
  );

  const handleTextInput = useCallback(() => {
    if (inputText) {
      handleInput(inputText);
      setInputText('');
    }
  }, [inputText, handleInput]);

  const handleTextInputSend = useCallback(() => {
    if (inputText) {
      handleInput(inputText + '\n');
      setInputText('');
    }
  }, [inputText, handleInput]);

  const statusColor = STATUS_COLORS[status] ?? Colors.surface[400];
  const isActive = status === 'running' || status === 'thinking' || status === 'executing';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.toolbar, { backgroundColor: c.card, borderBottomColor: c.cardBorder }]}>
        <View style={[styles.statusDotOuter, { borderColor: statusColor }]}>
          {isActive && <View style={[styles.statusDotPulse, { backgroundColor: statusColor }]} />}
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>
        <Text style={[styles.sessionId, { color: c.textSecondary }]}>{sessionId?.slice(0, 8)}</Text>
        <View style={[styles.statusChip, { backgroundColor: statusColor + '18' }]}>
          <Text style={[styles.statusChipText, { color: statusColor }]}>{status}</Text>
        </View>
        <View style={styles.spacer} />
        <Pressable
          onPress={() => router.push(`/agent/${sessionId}`)}
          style={styles.toolbarButton}
        >
          <Text style={[styles.toolbarButtonText, { color: c.textTertiary }]}>Events</Text>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          style={[styles.doneButton, { backgroundColor: c.elevated, borderColor: c.cardBorder }]}
        >
          <Text style={[styles.doneButtonText, { color: c.textPrimary }]}>Done</Text>
        </Pressable>
      </View>

      <XtermWebView
        ref={xtermRef}
        onInput={handleInput}
        onResize={handleResize}
        onStatus={(loaded, error) => {
          setXtermStatus(loaded ? 'xterm loaded' : `xterm error: ${error}`);
        }}
      />

      <View style={[styles.inputBar, { backgroundColor: c.card, borderTopColor: c.cardBorder }]}>
        <TextInput
          ref={textInputRef}
          style={[styles.textInput, { backgroundColor: c.inputBg, borderColor: c.inputBorder, color: c.textPrimary }]}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleTextInputSend}
          returnKeyType="send"
          placeholder="Type command..."
          placeholderTextColor={c.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {inputText.length > 0 && (
          <>
            <Pressable
              onPress={handleTextInput}
              style={[styles.sendBtn, { backgroundColor: c.elevated, borderColor: c.cardBorder }]}
            >
              <Text style={[styles.sendBtnText, { color: c.textSecondary }]}>Send</Text>
            </Pressable>
            <Pressable
              onPress={handleTextInputSend}
              style={[styles.sendBtn, { backgroundColor: '#3b82f6' }]}
            >
              <Text style={styles.sendBtnEnter}>↵</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={[styles.shortcutBar, { backgroundColor: c.card, borderTopColor: c.cardBorder }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutScroll}>
          {SHORTCUT_KEYS.map((key) => (
            <Pressable
              key={key.label}
              onPress={() => handleInput(key.data)}
              style={({ pressed }) => [
                styles.shortcutKey,
                {
                  backgroundColor: pressed ? c.elevated : c.subtle,
                  borderColor: c.cardBorder,
                },
              ]}
            >
              <Text style={[styles.shortcutKeyLabel, { color: c.textSecondary }]}>{key.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {!wsConnected && (
        <View style={styles.disconnectBanner}>
          <View style={styles.disconnectBannerContent}>
            <Text style={styles.disconnectIcon}>{'\u{26A0}'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.disconnectTitle}>Not Connected</Text>
              <Text style={styles.disconnectDesc}>
                Go to Settings and configure your daemon connection
              </Text>
            </View>
            <Pressable
              onPress={() => router.push('/(tabs)/settings')}
              style={styles.disconnectButton}
            >
              <Text style={styles.disconnectButtonText}>Settings</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    gap: 6,
    minHeight: 44,
  },
  statusDotOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    opacity: 0.3,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sessionId: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  statusChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderCurve: 'continuous',
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  spacer: { flex: 1 },
  toolbarButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderCurve: 'continuous',
    minHeight: 32,
    justifyContent: 'center',
  },
  toolbarButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  doneButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 1,
    fontSize: 15,
    fontFamily: 'monospace',
  },
  sendBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sendBtnEnter: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  shortcutBar: {
    borderTopWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    paddingBottom: Platform.OS === 'ios' ? 30 : 6,
  },
  shortcutScroll: {
    gap: 4,
    paddingRight: 8,
  },
  shortcutKey: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shortcutKeyLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  disconnectBanner: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    overflow: 'hidden',
  },
  disconnectBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  disconnectIcon: {
    fontSize: 18,
  },
  disconnectTitle: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '700',
  },
  disconnectDesc: {
    color: '#fca5a5',
    fontSize: 11,
    opacity: 0.7,
    marginTop: 2,
  },
  disconnectButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(239,68,68,0.2)',
    minHeight: 32,
    justifyContent: 'center',
  },
  disconnectButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f87171',
  },
});
