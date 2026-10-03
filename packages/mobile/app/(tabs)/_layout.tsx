import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
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
  { name: 'pipelines', label: 'Pipelines', icon: 'git-branch' as const, title: 'Pipelines' },
  { name: 'settings', label: 'Settings', icon: 'settings' as const, title: 'Settings' },
] as const;

/** Lens flush to the item; the capsule's own padding is the visual inset. */
const LENS_INSET = 0;
const LENS_ITEM_GAP = 1;
const TAB_WIDTH = 84;
const ICON_SIZE = 24;
/** Snappier than the tab-bar-wide morph spring — small mass, quick settle. */
const LENS_SPRING = { damping: 24, stiffness: 320, mass: 1 } as const;

/** Native icon bounce on selection: 1 → 1.12 → 1. */
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
        withSpring(1.06, { damping: 14, stiffness: 320 }),
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
 * iOS 26/27 native floating TabBar (matched to a system screenshot):
 * near-opaque chrome-glass capsule with a 1px specular top edge, hovering
 * above the home indicator. Active tab = a NEUTRAL secondary-glass lens
 * capsule behind icon + label together; the tint lives on the icon and
 * label, not the lens. Inactive items are primary monochrome. Selection
 * bounces the icon, the lens springs across.
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
      lensX.value = withSpring(frame.x + LENS_ITEM_GAP, LENS_SPRING);
      lensW.value = withSpring(frame.width - LENS_ITEM_GAP * 2, LENS_SPRING);
    }
  }, [activeIndex, frameVersion, frames, lensX, lensW]);

  const lensStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lensX.value }],
    width: lensW.value,
    opacity: lensW.value > 1 ? 1 : 0,
  }));

  const activeTint = c.isDark ? Colors.primary[300] : Colors.primary[600];

  return (
    <View
      onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
      style={{
        position: 'absolute',
        bottom: insets.bottom + Spacing.md,
        alignSelf: 'center',
        /* ambient layer of the float shadow — the tight contact shadow
         * lives on the capsule itself, layered like the native material */
        shadowColor: '#08090a',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: c.isDark ? 0.12 : 0.07,
        shadowRadius: 28,
      }}
      pointerEvents="box-none"
    >
      <BlurView
        tint={c.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={Glass.blur.tabBar}
        style={{
          flexDirection: 'row',
          borderRadius: 999,
          padding: Spacing.xs,
          overflow: 'hidden',
          backgroundColor: c.isDark ? 'rgba(25,26,29,0.96)' : 'rgba(252,253,254,0.94)',
          /* specular rim — brightest at top; RN border is uniform, so the
           * alpha is tuned low to stay inside native restraint */
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.6)',
          shadowColor: '#08090a',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: c.isDark ? 0.1 : 0.05,
          shadowRadius: 5,
          elevation: 6,
        }}
      >
        {/* Neutral secondary-glass lens — icon + label together, springs across.
         * Full item width, flush to the capsule padding, no outer shadow. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: LENS_INSET,
              bottom: LENS_INSET,
              borderRadius: 999,
              backgroundColor: c.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.09)',
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
                width: TAB_WIDTH,
                paddingVertical: Spacing.xs - 2,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <BouncingIcon
                name={isFocused ? iconName : `${iconName}-outline`}
                focused={isFocused}
                color={isFocused ? activeTint : c.textPrimary}
              />
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 13,
                  marginTop: 2,
                  fontWeight: '400',
                  color: isFocused ? activeTint : c.textPrimary,
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
