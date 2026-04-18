import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { wsService } from '../../src/services/websocket';
import { STATUS_COLORS } from '../../src/constants/colors';
import { XtermWebView, type XtermWebViewRef } from '../../src/components/XtermWebView';

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const xtermRef = useRef<XtermWebViewRef>(null);
  const [status, setStatus] = useState('running');

  useEffect(() => {
    if (!sessionId) return;

    wsService.send({ type: 'control', action: 'attach_session', sessionId });

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

    return () => {
      unsubOutput();
      unsubStatus();
      wsService.send({ type: 'control', action: 'detach_session', sessionId });
    };
  }, [sessionId]);

  const handleInput = useCallback(
    (data: string) => {
      if (!sessionId) return;
      wsService.send({ type: 'terminal_input', sessionId, data });
    },
    [sessionId],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#1e1e1e' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Toolbar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: '#2d2d2d' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLORS[status] ?? '#94a3b8', marginRight: 8 }} />
        <Text style={{ color: '#ccc', fontSize: 12, fontFamily: 'monospace' }}>{sessionId?.slice(0, 8)}</Text>
        <Text style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>{status}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => router.push(`/agent/${sessionId}`)} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#3b82f6', fontSize: 13 }}>Events</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#999', fontSize: 13 }}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* xterm.js Terminal */}
      <XtermWebView ref={xtermRef} onInput={handleInput} />
    </KeyboardAvoidingView>
  );
}
