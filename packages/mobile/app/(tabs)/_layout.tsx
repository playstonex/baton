import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Typography, Spacing, Colors, Glass, Shadows } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useLayoutStore } from '../../src/stores/layout';
import { OfflineBanner } from '../../src/components/OfflineBanner';

const TAB_ITEMS = [
  { name: 'index', label: 'Agents', icon: 'grid' as const, title: 'Dashboard' },
  { name: 'pipelines', label: 'Pipelines', icon: 'git-branch' as const, title: 'Pipelines' },
  { name: 'settings', label: 'Settings', icon: 'settings' as const, title: 'Settings' },
] as const;

/**
 * Floating glass tab bar (v1 layout): a rounded island detached from the
 * bottom edge, every tab always showing icon + label. The active tab is
 * highlighted by a glass lens that springs across to cover the whole item —
 * icon and text together. Slot sizes are static, so one measurement pass
 * positions the lens for good.
 */
function FloatingTabBar({ state, descriptors, navigation }: any) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const setTabBarHeight = useLayoutStore((s) => s.setTabBarHeight);

  const frames = useRef<Map<number, { x: number; width: number }>>(new Map()).current;
  const [frameVersion, setFrameVersion] = useState(0);
  const lensX = useSharedValue(0);
  const lensW = useSharedValue(0);

  const activeIndex = state.index as number;

  useEffect(() => {
    const frame = frames.get(activeIndex);
    if (frame) {
      lensX.value = withSpring(frame.x, Glass.morph.spring);
      lensW.value = withSpring(frame.width, Glass.morph.spring);
    }
  }, [activeIndex, frameVersion, frames, lensX, lensW]);

  const lensStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lensX.value }],
    width: lensW.value,
    opacity: lensW.value > 1 ? 1 : 0,
  }));

  return (
    <View
      onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
      style={{
        position: 'absolute',
        bottom: insets.bottom + Spacing.sm + 2,
        alignSelf: 'center',
      }}
      pointerEvents="box-none"
    >
      <BlurView
        tint={c.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={Glass.blur.tabBar}
        style={{
          flexDirection: 'row',
          borderRadius: 999,
          padding: Spacing.sm,
          overflow: 'hidden',
          backgroundColor: c.glassTabBar,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
          ...Shadows.elevated,
        }}
      >
        {/* Sliding glass lens — covers the whole active tab, label included. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: Spacing.sm,
              bottom: Spacing.sm,
              borderRadius: 999,
              backgroundColor: c.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(120,120,128,0.16)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.05)',
              ...Shadows.card,
            },
            lensStyle,
          ]}
        />

        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const tabItem = TAB_ITEMS.find((t) => t.name === route.name);
          const iconName = tabItem?.icon ?? 'ellipse';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLayout={(e) => {
                frames.set(index, {
                  x: e.nativeEvent.layout.x,
                  width: e.nativeEvent.layout.width,
                });
                if (index === state.routes.length - 1) {
                  setFrameVersion((v) => v + 1);
                }
              }}
              style={({ pressed }) => ({
                paddingHorizontal: Spacing.lg,
                paddingVertical: Spacing.sm,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons
                name={(isFocused ? iconName : `${iconName}-outline`) as any}
                size={25}
                color={isFocused ? Colors.primary[500] : c.textPrimary}
              />
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 16,
                  fontWeight: isFocused ? '600' : '500',
                  color: isFocused ? Colors.primary[500] : c.textPrimary,
                }}
                allowFontScaling={false}
              >
                {options.tabBarLabel ?? options.title ?? route.name}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

export default function TabLayout() {
  const c = useThemeColors();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerTransparent: true,
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
        {TAB_ITEMS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarLabel: tab.label,
            }}
          />
        ))}
      </Tabs>
      <OfflineBanner />
    </View>
  );
}
