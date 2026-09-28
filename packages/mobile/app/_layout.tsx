import '../global.css';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Platform, View, ActivityIndicator } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { HeroUINativeProvider } from 'heroui-native';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

import { useConnectionStore } from '../src/stores/connection';
import { useAgentStore } from '../src/stores/agents';
import { useRecentStore } from '../src/stores/recent';
import { useOnboardingStore } from '../src/stores/onboarding';
import { wsService } from '../src/services/websocket';
import { notificationService } from '../src/services/notifications';
import {
  loadHosts,
  getActiveHostId,
  migrateLegacyCredentialsIfNeeded,
  hostToConnection,
} from '../src/services/secure-storage';
import { useDeepLinking } from '../src/hooks/useDeepLinking';
import { Typography } from '../src/constants/theme';
import { useThemeStore } from '../src/stores/theme';
import { useTerminalSettingsStore } from '../src/stores/terminal-settings';
import { useThemeColors } from '../src/hooks/useThemeColors';

function SessionNavigationWiring() {
  // Activates deep-link + push-notification → router navigation.
  useDeepLinking();
  const router = useRouter();

  useEffect(() => {
    // Push notification tap → navigate to the session's chat screen.
    const unsub = notificationService.onSessionNavigation((sessionId) => {
      router.navigate(`/chat/${sessionId}`);
    });
    return unsub;
  }, [router]);

  return null;
}

export default function RootLayout() {
  const setHosts = useConnectionStore((s) => s.setHosts);
  const setActiveHost = useConnectionStore((s) => s.setActiveHost);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const loadTerminalSettings = useTerminalSettingsStore((s) => s.loadSettings);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const loadRecent = useRecentStore((s) => s.loadRecent);
  const loadOnboarding = useOnboardingStore((s) => s.loadOnboarding);
  const onboardingLoaded = useOnboardingStore((s) => s.isLoaded);
  const hasCompletedOnboarding = useOnboardingStore((s) => s.hasCompletedOnboarding);
  const initialized = useRef(false);

  // Boot gate: stay on a splash until async store loads finish, so the
  // first-launch redirect to /onboarding doesn't flash the wrong screen.
  const [booted, setBooted] = useState(false);

  // Display + mono faces for titles and machine data (see theme.FontFamily).
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
  });

  const c = useThemeColors();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    loadTheme();
    loadTerminalSettings();
    loadAgents();
    loadRecent();
    loadOnboarding();

    (async () => {
      // Migrate any legacy single-host credentials into the hosts array.
      await migrateLegacyCredentialsIfNeeded();

      // Load the multi-host list and active host.
      const hosts = await loadHosts();
      setHosts(hosts);
      const activeId = await getActiveHostId();
      if (activeId) setActiveHost(activeId);

      // Auto-connect to the active host if there is one. setActiveHost above
      // already populated the legacy connection fields from the host profile.
      const active = hosts.find((h) => h.id === activeId) ?? hosts[0];
      if (active) {
        wsService.configure(hostToConnection(active));
        wsService.connect();
      }

      setBooted(true);
    })();

    const unsub = wsService.on('_state', () => {
      const nowConnected = wsService.connected;
      setConnected(nowConnected);
      // Re-register push token on every reconnect: the daemon maps tokens by
      // clientId, which changes per connection.
      if (nowConnected) {
        notificationService.initialize().then(() => notificationService.registerWithDaemon());
      }
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

  // Boot splash until fonts + onboarding state + hosts are loaded.
  if (!booted || !onboardingLoaded || !fontsLoaded) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}
      >
        <ActivityIndicator size="large" color={c.accentBg} />
      </View>
    );
  }

  // Connection-first flow: with no saved server, land on /connect instead of
  // the dashboard. Handled by <ConnectRedirect /> inside the main Stack below.

  // First-launch gate: show onboarding until the user completes it.
  if (!hasCompletedOnboarding) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <HeroUINativeProvider>
          <StatusBar style={c.isDark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="onboarding" />
          </Stack>
        </HeroUINativeProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <StatusBar style={c.isDark ? 'light' : 'dark'} />
        <SessionNavigationWiring />
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
            name="connect"
            options={{
              headerShown: false,
            }}
          />
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
