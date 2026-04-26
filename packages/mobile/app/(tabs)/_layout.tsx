import { Tabs } from 'expo-router';
import { View, Text, Platform, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography, Spacing } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

const TAB_ITEMS = [
  { name: 'index', label: 'Agents', icon: 'grid' as const, title: 'Dashboard' },
  { name: 'files', label: 'Files', icon: 'folder' as const, title: 'Files' },
  { name: 'pipelines', label: 'Pipelines', icon: 'git-branch' as const, title: 'Pipelines' },
  { name: 'settings', label: 'Settings', icon: 'settings' as const, title: 'Settings' },
] as const;

function FloatingTabBar({ state, descriptors, navigation }: any) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        bottom: insets.bottom + 8,
        left: 20,
        right: 20,
      }}
    >
      <BlurView
        tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
        intensity={c.isDark ? 50 : 65}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          borderRadius: 28,
          paddingVertical: 10,
          paddingHorizontal: 8,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: c.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)',
        }}
      >
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const tabItem = TAB_ITEMS.find((t) => t.name === route.name);
          const iconName = tabItem?.icon ?? 'ellipse';

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isFocused
                    ? c.isDark
                      ? 'rgba(59,130,246,0.2)'
                      : 'rgba(59,130,246,0.12)'
                    : 'transparent',
                }}
              >
                <Ionicons
                  name={(isFocused ? iconName : `${iconName}-outline`) as any}
                  size={isFocused ? 24 : 22}
                  color={isFocused ? '#3b82f6' : c.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'}
                />
              </View>
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: isFocused ? '600' : '500',
                  color: isFocused
                    ? '#3b82f6'
                    : c.isDark
                      ? 'rgba(255,255,255,0.4)'
                      : 'rgba(0,0,0,0.3)',
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
        headerStyle: {
          backgroundColor: c.bg,
          shadowColor: 'transparent',
          elevation: 0,
        },
        headerTitleStyle: {
          ...Typography.lg,
          fontWeight: '600',
          color: c.textPrimary,
          letterSpacing: -0.02,
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
