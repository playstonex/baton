import { StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { Button, Chip } from 'heroui-native';
import { wsService } from '../../src/services/websocket';
import { STATUS_COLORS, Colors } from '../../src/constants/theme';
import { XtermWebView, type XtermWebViewRef } from '../../src/components/XtermWebView';

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const xtermRef = useRef<XtermWebViewRef>(null);
  const [status, setStatus] = useState('running');
  const [xtermStatus, setXtermStatus] = useState<string>('loading...');
  const [wsConnected, setWsConnected] = useState(wsService.connected);

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

  const STATUS_CHIP_COLOR: Record<string, 'success' | 'accent' | 'default' | 'warning' | 'danger'> = {
    running: 'success',
    thinking: 'accent',
    executing: 'default',
    waiting_input: 'warning',
    idle: 'default',
    stopped: 'danger',
    starting: 'default',
    error: 'danger',
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.toolbar}>
        <View
          style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] ?? Colors.surface[400] }]}
        />
        <Text style={styles.sessionId}>{sessionId?.slice(0, 8)}</Text>
        <Chip variant="soft" color={STATUS_CHIP_COLOR[status] ?? 'default'} size="sm">
          {status}
        </Chip>
        <View style={styles.spacer} />
        <Button variant="ghost" size="sm" onPress={() => router.push(`/agent/${sessionId}`)}>
          Events
        </Button>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          Done
        </Button>
      </View>

      <XtermWebView
        ref={xtermRef}
        onInput={handleInput}
        onResize={handleResize}
        onStatus={(loaded, error) => {
          setXtermStatus(loaded ? 'xterm loaded' : `xterm error: ${error}`);
        }}
      />

      {!wsConnected && (
        <View style={styles.disconnectBanner}>
          <Text style={styles.disconnectBannerTitle}>WebSocket not connected</Text>
          <Text style={styles.disconnectBannerDesc}>
            Go to Settings, configure daemon URL, then Connect
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface[900] },
  toolbar: { flexDirection: 'row', alignItems: 'center', padding: 8, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: '#2d2d2d', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sessionId: { color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  spacer: { flex: 1 },
  disconnectBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: Colors.danger[700], padding: 12, borderRadius: 8 },
  disconnectBannerTitle: { color: '#fff', fontSize: 12 },
  disconnectBannerDesc: { color: '#fecaca', fontSize: 10, marginTop: 2 },
});
