import { useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Typography, Spacing, Colors, Glass } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useLayoutStore } from '../../src/stores/layout';
import { OfflineBanner } from '../../src/components/OfflineBanner';

const TAB_ITEMS = [
  { name: 'index', label: 'Agents', icon: 'grid' as const, title: 'Dashboard' },
  { name: 'settings', label: 'Settings', icon: 'settings' as const, title: 'Settings' },
] as const;

const TAB_WIDTH = 96;
const LENS_INSET = 2;
const ICON_SIZE = 22;
const LENS_SPRING = { damping: 22, stiffness: 280, mass: 0.9 } as const;

/** Native icon micro-bounce on selection: 1 → 1.1 → 1. */
function BouncingIcon({
  name,
  focused,
  color,
}: {
  name: string;
  focused: boolean;
  color: string;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) {
      scale.value = withSequence(
        withSpring(1.08, { damping: 14, stiffness: 320 }),
        withTiming(1, { duration: 120 }),
      );
    }
  }, [focused, scale]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[{ height: 24, justifyContent: 'center' }, iconStyle]}>
      <Ionicons name={name as any} size={ICON_SIZE} color={color} />
    </Animated.View>
  );
}

/**
 * iOS 26 Liquid Glass Floating Island TabBar:
 * Ultra-compact 2-tab floating pill hovering above the home indicator.
 * Features an animated sliding frosted lens, specular top-edge rim,
 * and icon bounce physics.
 */
function FloatingTabBar({ state, descriptors, navigation }: any) {
  const router = useRouter();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const setTabBarHeight = useLayoutStore((s) => s.setTabBarHeight);
  const activeTint = c.isDark ? Colors.primary[300] : Colors.primary[600];

  const visibleRoutes = state.routes.filter(
    (route: any) => descriptors[route.key]?.options?.href !== null && route.name !== 'pipelines',
  );

  const activeIndex = visibleRoutes.findIndex(
    (r: any) => r.name === state.routes[state.index]?.name,
  );

  const lensX = useSharedValue(0);

  useEffect(() => {
    if (activeIndex >= 0) {
      lensX.value = withSpring(activeIndex * TAB_WIDTH + LENS_INSET, LENS_SPRING);
    }
  }, [activeIndex, lensX]);

  const lensStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lensX.value }],
  }));

  return (
    <View
      onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
      style={{
        position: 'absolute',
        bottom: insets.bottom + Spacing.sm,
        alignSelf: 'center',
        shadowColor: '#08090a',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: c.isDark ? 0.35 : 0.12,
        shadowRadius: 24,
        elevation: 10,
      }}
      pointerEvents="box-none"
    >
      <BlurView
        tint={c.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={Glass.blur.tabBar}
        style={{
          flexDirection: 'row',
          borderRadius: 999,
          padding: LENS_INSET,
          overflow: 'hidden',
          backgroundColor: c.isDark ? 'rgba(25, 26, 30, 0.90)' : 'rgba(252, 253, 254, 0.92)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.75)',
          shadowColor: '#08090a',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: c.isDark ? 0.15 : 0.08,
          shadowRadius: 6,
          elevation: 4,
        }}
      >
        {/* Sliding Liquid Glass Lens */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: LENS_INSET,
              bottom: LENS_INSET,
              width: TAB_WIDTH - LENS_INSET * 2,
              borderRadius: 999,
              backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.13)' : 'rgba(60, 60, 67, 0.09)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.04)',
            },
            lensStyle,
          ]}
        />

        {visibleRoutes.map((route: any) => {
          const isFocused = state.routes[state.index]?.name === route.name;
          const { options } = descriptors[route.key];
          const tabItem = TAB_ITEMS.find((t) => t.name === route.name);
          const iconName = tabItem?.icon ?? 'ellipse';
          const label = options.tabBarLabel ?? options.title ?? tabItem?.label ?? route.name;

          const onPress = () => {
            const event = navigation?.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event?.defaultPrevented) {
              if (route.name === 'index') {
                router.navigate('/(tabs)');
              } else {
                router.navigate(`/(tabs)/${route.name}` as any);
              }
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              hitSlop={6}
              style={({ pressed }) => [
                styles.tabItem,
                { opacity: pressed ? 0.65 : 1 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={label}
            >
              <BouncingIcon
                name={isFocused ? iconName : `${iconName}-outline`}
                focused={isFocused}
                color={isFocused ? activeTint : c.textTertiary}
              />
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isFocused ? activeTint : c.textTertiary,
                    fontWeight: isFocused ? '600' : '500',
                  },
                ]}
                allowFontScaling={false}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

export default function TabLayout() {
  const router = useRouter();
  const c = useThemeColors();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={() => null}
        screenOptions={{
          headerTransparent: true,
          tabBarStyle: { display: 'none' },
          headerBackground: () => (
            <BlurView
              tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
              intensity={Glass.blur.nav}
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
          headerTintColor: c.textPrimary,
          tabBarAllowFontScaling: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            headerShown: false,
            title: 'Chat',
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerShown: true,
            headerLeft: () => (
              <Pressable
                onPress={() => router.navigate('/(tabs)')}
                hitSlop={8}
                style={{ paddingLeft: Spacing.sm }}
                accessibilityLabel="Back to chat"
              >
                <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="pipelines"
          options={{
            title: 'Pipelines',
            headerShown: true,
            headerLeft: () => (
              <Pressable
                onPress={() => router.navigate('/(tabs)')}
                hitSlop={8}
                style={{ paddingLeft: Spacing.sm }}
                accessibilityLabel="Back to chat"
              >
                <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
              </Pressable>
            ),
          }}
        />
      </Tabs>
      <OfflineBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    width: TAB_WIDTH,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 10.5,
    lineHeight: 13,
    marginTop: 2,
    letterSpacing: -0.1,
  },
});
