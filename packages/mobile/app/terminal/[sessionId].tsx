import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useTerminalStore } from '../../src/stores/terminal';
import { wsService } from '../../src/services/websocket';
import { stripAnsi } from '../../src/services/ansi';
import { STATUS_COLORS } from '../../src/constants/colors';

const EMPTY_LINES: string[] = [];

export default function TerminalScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const lines = useTerminalStore((s) => s.sessions[sessionId ?? ''] ?? EMPTY_LINES);
  const addOutput = useTerminalStore((s) => s.addOutput);
  const clearSession = useTerminalStore((s) => s.clearSession);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('running');
  const flatListRef = useRef<FlatList>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    const unsubOutput = wsService.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        addOutput(sessionId, stripAnsi(msg.data));
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
      clearSession(sessionId);
    };
  }, [sessionId, addOutput, clearSession]);

  const sendInput = useCallback(() => {
    if (!input.trim() || !sessionId) return;
    wsService.send({ type: 'terminal_input', sessionId, data: input + '\n' });
    setInput('');
  }, [input, sessionId]);

  useEffect(() => {
    if (!userScrolledUp && lines.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [lines.length, userScrolledUp]);

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

      {/* Output */}
      <FlatList
        ref={flatListRef}
        data={lines}
        keyExtractor={(_, i) => String(i)}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          const atBottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 50;
          setUserScrolledUp(!atBottom);
        }}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => (
          <Text style={{ color: '#d4d4d4', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18 }}>
            {item}
          </Text>
        )}
      />

      {/* Input */}
      <View style={{ flexDirection: 'row', padding: 8, borderTopWidth: 1, borderTopColor: '#333', backgroundColor: '#2d2d2d' }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendInput}
          placeholder="Send input..."
          placeholderTextColor="#666"
          style={{
            flex: 1,
            color: '#d4d4d4',
            fontSize: 14,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            padding: 8,
            backgroundColor: '#1e1e1e',
            borderRadius: 6,
            marginRight: 8,
          }}
        />
        <TouchableOpacity onPress={sendInput} style={{ backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 14, justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '500' }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
