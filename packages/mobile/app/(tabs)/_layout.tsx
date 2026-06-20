import { Tabs } from 'expo-router';
import { View, Text, Platform, Pressable, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Typography,
  Spacing,
  Colors,
  Glass,
  CornerRadius,
} from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useLayoutStore } from '../../src/stores/layout';

const TAB_ITEMS = [
  { name: 'index', label: 'Agents', icon: 'grid' as const, title: 'Dashboard' },
  { name: 'pipelines', label: 'Pipelines', icon: 'git-branch' as const, title: 'Pipelines' },
  { name: 'settings', label: 'Settings', icon: 'settings' as const, title: 'Settings' },
] as const;

function FloatingTabBar({ state, descriptors, navigation }: any) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const setTabBarHeight = useLayoutStore((s) => s.setTabBarHeight);

  return (
    <View
      onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
      style={{
        position: 'absolute',
        bottom: insets.bottom + Spacing.md,
        left: Spacing.lg,
        right: Spacing.lg,
      }}
    >
      <BlurView
        tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
        intensity={Glass.blur.tabBar}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          borderRadius: CornerRadius.xl,
          paddingVertical: Spacing.sm + 2,
          paddingHorizontal: Spacing.md,
          overflow: 'hidden',
          backgroundColor: c.glassTabBar,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
        }}
      >
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
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 44,
                gap: 3,
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isFocused ? c.accentBg : 'transparent',
                  borderWidth: isFocused ? 1 : 0,
                  borderColor: isFocused ? c.accentBorder : 'transparent',
                }}
              >
                <Ionicons
                  name={(isFocused ? iconName : `${iconName}-outline`) as any}
                  size={isFocused ? 24 : 22}
                  color={isFocused ? Colors.primary[500] : c.textTertiary}
                />
              </View>
              <Text
                style={{
                  ...Typography.caption1,
                  fontWeight: isFocused ? '600' : '500',
                  color: isFocused ? Colors.primary[500] : c.textTertiary,
                }}
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
  );
}
