import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { HeroUINativeProvider } from 'heroui-native';

import { useConnectionStore } from '../src/stores/connection';
import { wsService } from '../src/services/websocket';
import { loadCredentials } from '../src/services/secure-storage';
import { Typography } from '../src/constants/theme';
import { useThemeStore } from '../src/stores/theme';
import { useThemeColors } from '../src/hooks/useThemeColors';

export default function RootLayout() {
  const setCredentials = useConnectionStore((s) => s.setCredentials);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const initialized = useRef(false);

  const c = useThemeColors();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    loadTheme();

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
        <StatusBar style={c.isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: c.textPrimary,
            headerStyle: {
              backgroundColor: c.bg,
            },
            headerTitleStyle: {
              ...Typography.lg,
              fontWeight: '600',
              color: c.textPrimary,
            },
            headerShadowVisible: false,
            contentStyle: {
              backgroundColor: c.bg,
            },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="terminal/[sessionId]"
            options={{
              title: 'Terminal',
              headerTintColor: c.textPrimary,
            }}
          />
          <Stack.Screen
            name="agent/[sessionId]"
            options={{
              title: 'Agent Detail',
              headerTintColor: c.textPrimary,
            }}
          />
        </Stack>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
