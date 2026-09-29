import '../global.css';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Platform, View, ActivityIndicator } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { HeroUINativeProvider } from 'heroui-native';
import { useFonts } from 'expo-font';
import { Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
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
  addHost,
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

  // Dev remote control (used by simulator screenshot automation): expose a
  // navigate hook + theme setter on globalThis, driven over the Hermes CDP
  // endpoint that Metro exposes in dev. Never present in release builds.
  if (__DEV__) {
    (global as unknown as Record<string, unknown>).__batonDev = {
      navigate: (path: string) => router.navigate(path as never),
      setTheme: useThemeStore.getState().setTheme,
    };
  }

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
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
  });

  const c = useThemeColors();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    loadTheme();
    // Dev-only override for screenshot tours: EXPO_PUBLIC_DEV_THEME forces
    // the theme after the saved preference loads. Inlined at bundle time.
    const devTheme = process.env.EXPO_PUBLIC_DEV_THEME;
    if (devTheme === 'light' || devTheme === 'dark') {
      loadTheme().then(() => useThemeStore.getState().setTheme(devTheme));
    }
    loadTerminalSettings();
    loadAgents();
    loadRecent();
    loadOnboarding();

    (async () => {
      // Migrate any legacy single-host credentials into the hosts array.
      await migrateLegacyCredentialsIfNeeded();

      // Dev convenience: EXPO_PUBLIC_DEV_AUTOCONNECT=<daemon http url> saves
      // and connects to that daemon on first launch, so simulator runs skip
      // manual pairing. Unset in normal builds — the block never runs.
      const devAutoConnect = process.env.EXPO_PUBLIC_DEV_AUTOCONNECT;

      // Load the multi-host list and active host.
      let hosts = await loadHosts();
      let activeId = await getActiveHostId();
      if (!activeId && hosts.length === 0 && devAutoConnect) {
        const saved = await addHost({
          mode: 'local',
          localHttpUrl: devAutoConnect,
          localWsUrl: devAutoConnect.replace(/^http/, 'ws').replace(/:\d+$/, ':3211'),
        });
        hosts = [saved];
        activeId = saved.id;
      }
      setHosts(hosts);
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
      // clientId, which changes per connection. Skipped under the dev
      // auto-connect env so the simulator run doesn't prompt for
      // notification permission.
      if (nowConnected && !process.env.EXPO_PUBLIC_DEV_AUTOCONNECT) {
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
