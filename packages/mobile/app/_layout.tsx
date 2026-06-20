import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Platform } from 'react-native';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { HeroUINativeProvider } from 'heroui-native';

import { useConnectionStore } from '../src/stores/connection';
import { useAgentStore } from '../src/stores/agents';
import { useRecentStore } from '../src/stores/recent';
import { wsService } from '../src/services/websocket';
import { loadCredentials } from '../src/services/secure-storage';
import { Typography } from '../src/constants/theme';
import { useThemeStore } from '../src/stores/theme';
import { useTerminalSettingsStore } from '../src/stores/terminal-settings';
import { useThemeColors } from '../src/hooks/useThemeColors';

export default function RootLayout() {
  const setCredentials = useConnectionStore((s) => s.setCredentials);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const loadTerminalSettings = useTerminalSettingsStore((s) => s.loadSettings);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const loadRecent = useRecentStore((s) => s.loadRecent);
  const initialized = useRef(false);

  const c = useThemeColors();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    loadTheme();
    loadTerminalSettings();
    loadAgents();
    loadRecent();

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

    wsService.onError((attempt) => {
      if (attempt === 1) {
        Alert.alert(
          'Connection Failed',
          'Could not connect to the daemon. Make sure it is running and check your settings.',
          [{ text: 'OK' }],
        );
      }
    });

    return () => {
      unsub();
      wsService.onError(() => {});
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <StatusBar style={c.isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerTintColor: c.textPrimary,
            headerTransparent: true,
            headerBackground: () => (
              <BlurView
                tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
                intensity={c.isDark ? 60 : 75}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: c.glassNav,
                }}
              />
            ),
            headerTitleStyle: {
              ...Typography.headline,
              color: c.textPrimary,
            },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="terminal/[sessionId]"
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="terminal-settings/[sessionId]"
            options={{
              title: 'Terminal Settings',
              headerTintColor: c.textPrimary,
              headerBackTitle: 'Terminal',
              headerBackTitleStyle: { fontSize: 17 },
            }}
          />
          <Stack.Screen
            name="agent/[sessionId]"
            options={{
              title: 'Agent Detail',
              headerTintColor: c.textPrimary,
              headerBackTitle: 'Back',
              headerBackTitleStyle: { fontSize: 17 },
            }}
          />
          <Stack.Screen
            name="chat/[sessionId]"
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="files/[sessionId]"
            options={{
              title: 'Files',
              headerTintColor: c.textPrimary,
              headerBackTitle: 'Back',
              headerBackTitleStyle: { fontSize: 17 },
            }}
          />
          <Stack.Screen
            name="git/[sessionId]"
            options={{
              title: 'Git',
              headerTintColor: c.textPrimary,
              headerBackTitle: 'Back',
              headerBackTitleStyle: { fontSize: 17 },
            }}
          />
        </Stack>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
