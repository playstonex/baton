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
import { useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { BlurView } from 'expo-blur';
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
import { useTerminalSettingsStore } from '../../src/stores/terminal-settings';
import {
  GlassCard,
  GlassButton,
  GlassPill,
} from '../../src/components/GlassKit';

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
    <View style={[waitingStyles.overlay]} pointerEvents="none">
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
    ...StyleSheet.absoluteFill,
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
  const termSettings = useTerminalSettingsStore();

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
        const next = msg.status as string;
        setStatus(next);
        if (next === 'running' || next === 'idle' || next === 'thinking' ||
            next === 'executing' || next === 'waiting_input') {
          setHasReceivedOutput(true);
        }
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

  const topPad = fullscreen ? insets.top : Math.max(headerHeight, insets.top);
  const bottomSafePad = insets.bottom;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: c.card }}>
        <View style={{ height: topPad }} />
        <KeyboardAvoidingView
          style={{ flex: 1, overflow: 'hidden' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >

      {/* Compact nav bar with status + actions */}
      {!fullscreen && (
        <BlurView
          tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          intensity={80}
          style={styles.navBar}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.navBack}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.primary[500]} />
            <Text style={[Typography.body, { color: Colors.primary[500], marginLeft: -2 }]}>
              Back
            </Text>
          </Pressable>

          <View style={styles.navStatus}>
            <StatusDot color={statusColor} active={isActive} />
            <View style={[styles.statusChip, { backgroundColor: statusColor + '18' }]}>
              <Text style={[styles.statusChipText, { color: statusColor }]}>
                {status}
              </Text>
            </View>
          </View>

          <View style={styles.navActions}>
            <Pressable
              onPress={() => router.push(`/terminal-settings/${sessionId}` as Href)}
              style={styles.navIconButton}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Ionicons name="settings-outline" size={18} color={c.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push(`/files/${sessionId}` as Href)}
              style={styles.navIconButton}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Ionicons name="folder-outline" size={18} color={c.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push(`/git/${sessionId}` as Href)}
              style={styles.navIconButton}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Ionicons name="git-branch-outline" size={18} color={c.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setFullscreen(true)}
              style={[styles.navIconButton, { backgroundColor: c.elevated, borderRadius: CornerRadius.small }]}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <Ionicons name="expand-outline" size={16} color={Colors.primary[500]} />
            </Pressable>
          </View>
        </BlurView>
      )}

      <XtermWebView
        ref={xtermRef}
        onInput={handleInput}
        onResize={handleResize}
        onStatus={(loaded, error) => {
          setXtermStatus(loaded ? 'xterm loaded' : `xterm error: ${error}`);
        }}
        termFontSize={termSettings.fontSize}
        termFontFamily={termSettings.fontFamily}
        termThemeName={termSettings.theme}
        termScrollback={termSettings.scrollback}
        termCursorBlink={termSettings.cursorBlink}
      />

      {!hasReceivedOutput && !sessionError && (
        <WaitingOverlay wsConnected={wsConnected} attached={attachSent.current} />
      )}

      {!!sessionError && (
        <View style={[waitingStyles.overlay]} pointerEvents="auto">
          <GlassCard c={c} style={{ alignItems: 'center', gap: Spacing.md, maxWidth: 320, width: '85%' }}>
            <Ionicons name="alert-circle-outline" size={36} color={Colors.danger[400]} />
            <Text style={[Typography.headline, { color: c.textPrimary, fontWeight: '700', textAlign: 'center' }]}>
              Session Unavailable
            </Text>
            <Text style={[Typography.subhead, { color: c.textTertiary, textAlign: 'center', lineHeight: 22 }]}>
              {sessionError}
            </Text>
            <GlassButton c={c} label="Go Back" onPress={() => router.back()} variant="secondary" />
            <GlassButton c={c} label="Dashboard" onPress={() => router.replace('/(tabs)')} variant="primary" />
          </GlassCard>
        </View>
      )}

      <View style={[styles.inputBar, { borderTopColor: c.separator }]}>
        <TextInput
          ref={textInputRef}
          style={{
            flex: 1,
            height: 40,
            paddingHorizontal: 12,
            borderRadius: CornerRadius.medium,
            borderWidth: 1,
            backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
            borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
            color: c.textPrimary,
            ...Typography.subhead,
            fontFamily: 'monospace',
          }}
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
            <GlassButton
              c={c}
              label="Send"
              onPress={handleTextInput}
              variant="secondary"
            />
            <Pressable
              onPress={handleTextInputSend}
              style={{
                width: 36,
                height: 36,
                borderRadius: CornerRadius.small,
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: Colors.primary[500],
              }}
            >
              <Text style={{ ...Typography.subhead, fontWeight: '700', color: '#FFFFFF' }}>{'\u21B5'}</Text>
            </Pressable>
          </>
        )}
      </View>

      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={80}
        style={[styles.shortcutBar, { paddingBottom: 6 + bottomSafePad }]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shortcutScroll}
        >
          {SHORTCUT_KEYS.map((key) => (
            <GlassPill
              key={key.label}
              c={c}
              label={key.label}
              onPress={() => handleInput(key.data)}
            />
          ))}
          <GlassPill
            c={c}
            label={fullscreen ? '\u2715' : '\u26F6'}
            color={Colors.primary[500]}
            onPress={() => setFullscreen((f) => !f)}
          />
        </ScrollView>
      </BlurView>

      {fullscreen && (
        <Pressable
          onPress={() => setFullscreen(false)}
          style={{
            position: 'absolute',
            right: Spacing.lg,
            top: insets.top + Spacing.md,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: CornerRadius.medium,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: 'rgba(255,255,255,0.1)',
            backgroundColor: c.card,
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[Typography.caption1, { color: c.textSecondary, fontWeight: '600' }]}>
            {'\u2715'} Exit
          </Text>
        </Pressable>
      )}

      {!wsConnected && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: bottomSafePad + 16 }}>
          <GlassCard c={c}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={Typography.subhead}>{'\u26A0'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[Typography.subhead, { color: Colors.danger[400], fontWeight: '700' }]}>
                  Not Connected
                </Text>
                <Text style={[Typography.caption1, { color: Colors.danger[400], opacity: 0.75, marginTop: 2 }]}>
                  Go to Settings and configure your daemon connection
                </Text>
              </View>
              <GlassButton
                c={c}
                label="Settings"
                onPress={() => router.push('/(tabs)/settings')}
                variant="danger"
              />
            </View>
          </GlassCard>
        </View>
      )}
    </KeyboardAvoidingView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 44,
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  navIconButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'transparent',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusDotInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
  },
  statusChipText: {
    ...Typography.caption2,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  shortcutBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  shortcutScroll: {
    gap: 6,
    paddingRight: 8,
  },
});
