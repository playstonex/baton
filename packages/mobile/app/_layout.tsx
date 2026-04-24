import '../global.css';
import { Stack } from 'expo-router';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { HeroUINativeProvider } from 'heroui-native';
import { useConnectionStore } from '../src/stores/connection';
import { wsService } from '../src/services/websocket';
import { loadCredentials } from '../src/services/secure-storage';

export default function RootLayout() {
  const setCredentials = useConnectionStore((s) => s.setCredentials);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const saved = await loadCredentials();
      if (saved) {
        setCredentials(saved);
        wsService.configure(saved);
        wsService.connect();
      }
    })();

    const unsub = wsService.on('_state', () => {
      setConnected(wsService.connected);
    });

    return unsub;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="terminal/[sessionId]" options={{ title: 'Terminal' }} />
          <Stack.Screen name="agent/[sessionId]" options={{ title: 'Agent Detail' }} />
        </Stack>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
