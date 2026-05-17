import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { wsService } from '../../src/services/websocket';
import {
  STATUS_COLORS,
  Colors,
  Typography,
  CornerRadius,
  Spacing,
} from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { XtermWebView, type XtermWebViewRef } from '../../src/components/XtermWebView';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SHORTCUT_KEYS: { label: string; data: string }[] = [
  { label: '\u2191', data: '\x1b[A' },
  { label: '\u2193', data: '\x1b[B' },
  { label: '\u2190', data: '\x1b[D' },
  { label: '\u2192', data: '\x1b[C' },
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '/', data: '/' },
  { label: '~', data: '~' },
];

function WaitingOverlay({ wsConnected, attached }: { wsConnected: boolean; attached: boolean }) {
  const c = useThemeColors();
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => spin.stop();
  }, [spinAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  let label: string;
  let iconName: string;
  if (!wsConnected) {
    label = 'Connecting to daemon';
    iconName = 'cloud-outline';
  } else if (!attached) {
    label = 'Attaching to session';
    iconName = 'link-outline';
  } else {
    label = 'Waiting for agent output';
    iconName = 'terminal-outline';
  }

  const rotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[waitingStyles.overlay, { backgroundColor: c.bg }]} pointerEvents="none">
      <Animated.View style={{ transform: [{ rotate: rotation }] }}>
        <Ionicons name="sync-outline" size={28} color={c.textTertiary} />
      </Animated.View>
      <View style={waitingStyles.textWrap}>
        <Ionicons name={iconName as any} size={16} color={c.textTertiary} />
        <Text style={[waitingStyles.label, { color: c.textSecondary }]}>
          {label}
        </Text>
        <Text style={[waitingStyles.dots, { color: c.textTertiary }]}>
          {'.'.repeat(dotCount)}
        </Text>
      </View>
    </View>
  );
}

const waitingStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  textWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  label: {
    ...Typography.subhead,
    fontWeight: '500',
  },
  dots: {
    ...Typography.subhead,
    fontWeight: '500',
    width: 24,
  },
});

const errorStyles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.large,
    borderWidth: 1,
    padding: Spacing['2xl'],
    alignItems: 'center',
    gap: Spacing.md,
    maxWidth: 320,
    width: '85%',
  },
  title: {
    ...Typography.headline,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    ...Typography.subhead,
    textAlign: 'center',
    lineHeight: 22,
  },
  btn: {
    borderRadius: CornerRadius.medium,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  btnText: {
    ...Typography.subhead,
    fontWeight: '600',
  },
});

function StatusDot({
  color,
  active,
}: {
  color: string;
  active: boolean;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.6,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulseAnim]);

  return (
    <View style={styles.statusDotOuter}>
      {active && (
        <Animated.View
          style={[
            styles.statusDotPulse,
            {
              backgroundColor: color,
              transform: [{ scale: pulseAnim }],
              opacity: pulseAnim.interpolate({
                inputRange: [1, 1.6],
                outputRange: [0.25, 0],
              }),
            },
          ]}
        />
      )}
      <View style={[styles.statusDotInner, { backgroundColor: color }]} />
    </View>
  );
}

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const xtermRef = useRef<XtermWebViewRef>(null);
  const textInputRef = useRef<TextInput>(null);
  const [status, setStatus] = useState('running');
  const [xtermStatus, setXtermStatus] = useState<string>('loading...');
  const [wsConnected, setWsConnected] = useState(wsService.connected);
  const [hasReceivedOutput, setHasReceivedOutput] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const attachSent = useRef(false);
  const [inputText, setInputText] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

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
        setHasReceivedOutput(true);
      }
    });

    const unsubHistory = wsService.on('history_replay', (msg) => {
      if (msg.type === 'history_replay' && msg.sessionId === sessionId) {
        xtermRef.current?.write(msg.output);
        setHasReceivedOutput(true);
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (
        msg.type === 'status_update' &&
        msg.sessionId === sessionId &&
        'status' in msg
      ) {
        setStatus(msg.status as string);
      }
    });

    const unsubState = wsService.on('_state', () => {
      setWsConnected(wsService.connected);
    });

    const unsubError = wsService.on('error', (msg) => {
      if ('message' in msg) {
        const message = (msg as { message: string }).message;
        xtermRef.current?.write(
          `\x1b[31mError: ${message}\x1b[0m\r\n`,
        );
        if (message.includes('not found') || message.includes('Not found')) {
          setSessionError(message);
        }
      }
    });

    return () => {
      unsubOutput();
      unsubHistory();
      unsubStatus();
      unsubState();
      unsubError();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !wsConnected) return;

    wsService.send({
      type: 'control',
      action: 'attach_session',
      sessionId,
    });
    attachSent.current = true;

    return () => {
      attachSent.current = false;
      wsService.send({
        type: 'control',
        action: 'detach_session',
        sessionId,
      });
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

  const handleSubmitEditing = useCallback(
    (e: { nativeEvent: { text: string } }) => {
      const text = e.nativeEvent.text;
      if (!text) return;
      handleInput(text + '\n');
      setInputText('');
    },
    [handleInput],
  );

  const statusColor = STATUS_COLORS[status] ?? Colors.surface[400];
  const isActive =
    status === 'running' || status === 'thinking' || status === 'executing';

  const topPad = fullscreen ? insets.top : headerHeight;
  const bottomSafePad = insets.bottom;

  const renderShortcutKeys = () =>
    SHORTCUT_KEYS.map((key) => (
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
        <Text style={[styles.shortcutKeyLabel, { color: c.textSecondary }]}>
          {key.label}
        </Text>
      </Pressable>
    ));

  return (
    <>
      <Stack.Screen options={{ headerShown: !fullscreen }} />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: c.bg, paddingTop: topPad }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      {/* Toolbar */}
      {!fullscreen && (
        <View
          style={[
            styles.toolbar,
            {
              backgroundColor: c.card,
              borderBottomColor: c.separator,
            },
          ]}
        >
          <StatusDot color={statusColor} active={isActive} />

          <Text
            style={[styles.sessionId, { color: c.textSecondary }]}
          >
            {sessionId?.slice(0, 8)}
          </Text>

          <View
            style={[
              styles.statusChip,
              { backgroundColor: statusColor + '18' },
            ]}
          >
            <Text style={[styles.statusChipText, { color: statusColor }]}>
              {status}
            </Text>
          </View>

          <View style={styles.spacer} />

          <Pressable
            onPress={() => setFullscreen(true)}
            style={[styles.fullscreenButton, { backgroundColor: c.elevated }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.fullscreenButtonIcon]}>
              {'\u26F6'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push(`/agent/${sessionId}`)}
            style={styles.eventsButton}
          >
            <Text style={[styles.eventsButtonText]}>
              Events
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={[
              styles.doneButton,
              { backgroundColor: c.elevated },
            ]}
          >
            <Text style={[styles.doneButtonText, { color: c.textPrimary }]}>
              Done
            </Text>
          </Pressable>
        </View>
      )}

      <XtermWebView
        ref={xtermRef}
        onInput={handleInput}
        onResize={handleResize}
        onStatus={(loaded, error) => {
          setXtermStatus(loaded ? 'xterm loaded' : `xterm error: ${error}`);
        }}
      />

      {!hasReceivedOutput && !sessionError && (
        <WaitingOverlay wsConnected={wsConnected} attached={attachSent.current} />
      )}

      {!!sessionError && (
        <View style={[waitingStyles.overlay, { backgroundColor: c.bg }]} pointerEvents="auto">
          <View style={[errorStyles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Ionicons name="alert-circle-outline" size={36} color={Colors.danger[400]} />
            <Text style={[errorStyles.title, { color: c.textPrimary }]}>
              Session Unavailable
            </Text>
            <Text style={[errorStyles.message, { color: c.textTertiary }]}>
              {sessionError}
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={[errorStyles.btn, { backgroundColor: c.subtle }]}
            >
              <Text style={[errorStyles.btnText, { color: c.textPrimary }]}>Go Back</Text>
            </Pressable>
            <Pressable
              onPress={() => router.replace('/(tabs)')}
              style={[errorStyles.btn, { backgroundColor: Colors.primary[500] }]}
            >
              <Text style={[errorStyles.btnText, { color: '#FFFFFF' }]}>Dashboard</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: c.card,
            borderTopColor: c.separator,
          },
        ]}
      >
        <TextInput
          ref={textInputRef}
          style={[
            styles.textInput,
            {
              backgroundColor: c.inputBg,
              borderColor: c.inputBorder,
              color: c.textPrimary,
            },
          ]}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSubmitEditing}
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
              style={[
                styles.sendBtn,
                { backgroundColor: c.elevated },
              ]}
            >
              <Text
                style={[styles.sendBtnText, { color: c.textSecondary }]}
              >
                Send
              </Text>
            </Pressable>
            <Pressable
              onPress={handleTextInputSend}
              style={[styles.enterBtn, { backgroundColor: Colors.primary[500] }]}
            >
              <Text style={styles.enterBtnText}>{'\u21B5'}</Text>
            </Pressable>
          </>
        )}
      </View>

      <View
        style={[
          styles.shortcutBar,
          {
            backgroundColor: c.card,
            borderTopColor: c.separator,
            paddingBottom: 6 + bottomSafePad,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shortcutScroll}
        >
          {renderShortcutKeys()}
          <Pressable
            onPress={() => setFullscreen((f) => !f)}
            style={({ pressed }) => [
              styles.shortcutKey,
              {
                backgroundColor: pressed ? c.elevated : c.subtle,
                borderColor: c.cardBorder,
              },
            ]}
          >
            <Text style={[styles.shortcutKeyLabel, { color: Colors.primary[500] }]}>
              {fullscreen ? '\u2715' : '\u26F6'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {fullscreen && (
        <Pressable
          onPress={() => setFullscreen(false)}
          style={[styles.exitFullscreenBtn, { backgroundColor: c.card, top: insets.top + Spacing.md }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[Typography.caption1, { color: c.textSecondary, fontWeight: '600' }]}>
            {'\u2715'} Exit
          </Text>
        </Pressable>
      )}

      {!wsConnected && (
        <View
          style={[
            styles.disconnectBanner,
            {
              backgroundColor: c.dangerBg,
              borderColor: Colors.danger[400],
              bottom: bottomSafePad + 16,
            },
          ]}
        >
          <View style={styles.disconnectContent}>
            <Text style={styles.disconnectIcon}>{'\u26A0'}</Text>
            <View style={styles.disconnectTextWrap}>
              <Text style={[styles.disconnectTitle, { color: Colors.danger[400] }]}>
                Not Connected
              </Text>
              <Text
                style={[styles.disconnectDesc, { color: Colors.danger[400] }]}
              >
                Go to Settings and configure your daemon connection
              </Text>
            </View>
            <Pressable
              onPress={() => router.push('/(tabs)/settings')}
              style={styles.disconnectBtn}
            >
              <Text style={styles.disconnectBtnText}>Settings</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
    minHeight: 50,
  },
  statusDotOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  statusDotInner: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sessionId: {
    ...Typography.caption1,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
  },
  statusChipText: {
    ...Typography.caption2,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  spacer: {
    flex: 1,
  },
  fullscreenButton: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenButtonIcon: {
    fontSize: 16,
    color: Colors.primary[500],
  },
  eventsButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  eventsButtonText: {
    ...Typography.caption1,
    fontWeight: '600',
    color: Colors.primary[500],
  },
  doneButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    minHeight: 32,
    justifyContent: 'center',
  },
  doneButtonText: {
    ...Typography.caption1,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    borderWidth: 1,
    ...Typography.subhead,
    fontFamily: 'monospace',
  },
  sendBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    minHeight: 36,
    justifyContent: 'center',
  },
  sendBtnText: {
    ...Typography.caption1,
    fontWeight: '600',
  },
  enterBtn: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enterBtnText: {
    ...Typography.subhead,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  shortcutBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  shortcutScroll: {
    gap: 6,
    paddingRight: 8,
  },
  shortcutKey: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shortcutKeyLabel: {
    ...Typography.caption1,
    fontWeight: '600',
  },
  exitFullscreenBtn: {
    position: 'absolute',
    right: Spacing.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  disconnectBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  disconnectContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  disconnectIcon: {
    ...Typography.subhead,
  },
  disconnectTextWrap: {
    flex: 1,
  },
  disconnectTitle: {
    ...Typography.subhead,
    fontWeight: '700',
  },
  disconnectDesc: {
    ...Typography.caption1,
    opacity: 0.75,
    marginTop: 2,
  },
  disconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,59,48,0.2)',
    minHeight: 32,
    justifyContent: 'center',
  },
  disconnectBtnText: {
    ...Typography.caption1,
    fontWeight: '600',
    color: Colors.danger[400],
  },
});
