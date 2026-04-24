import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Colors, Typography, Radius, Spacing } from '../../src/constants/theme';

const TAB_ITEMS = [
  { name: 'index', label: 'Agents', icon: '\u{1F9E0}', title: 'Dashboard' },
  { name: 'files', label: 'Files', icon: '\u{1F4C2}', title: 'Files' },
  { name: 'pipelines', label: 'Pipelines', icon: '\u{1F500}', title: 'Pipelines' },
  { name: 'settings', label: 'Settings', icon: '\u2699\uFE0F', title: 'Settings' },
] as const;

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 48, minHeight: 36 }}>
      <Text
        style={{
          fontSize: focused ? 24 : 22,
          opacity: focused ? 1 : 0.45,
          lineHeight: 28,
          textAlign: 'center',
        }}
      >
        {icon}
      </Text>
      {focused && (
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            width: 16,
            height: 2.5,
            borderRadius: Radius.full,
            backgroundColor: Colors.primary[400],
          }}
        />
      )}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.text.primary,
        tabBarInactiveTintColor: Colors.text.tertiary,
        tabBarStyle: {
          backgroundColor: Colors.glass.background,
          borderTopColor: Colors.glass.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingBottom: Platform.OS === 'ios' ? 32 : 8,
          paddingTop: Spacing.sm,
          paddingHorizontal: Spacing.xs,
          position: 'absolute',
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.02,
          marginTop: Platform.OS === 'ios' ? -2 : 2,
        },
        headerStyle: {
          backgroundColor: Colors.dark.bg,
          shadowColor: 'transparent',
          elevation: 0,
          borderBottomColor: Colors.glass.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
          height: 52,
        },
        headerTitleStyle: {
          ...Typography.lg,
          fontWeight: '700',
          color: Colors.text.primary,
          letterSpacing: -0.02,
        },
        headerShadowVisible: false,
        headerTintColor: Colors.text.primary,
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: 0,
          height: 36,
          width: 48,
        },
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
            tabBarIcon: ({ focused }) => <TabIcon icon={tab.icon} focused={focused} />,
          }}
        />
      ))}
    </Tabs>
  );
}

