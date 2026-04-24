import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { Colors, Typography } from '../../src/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary[400],
        tabBarInactiveTintColor: '#4b5563',
        tabBarStyle: {
          backgroundColor: Colors.dark.card,
          borderTopColor: Colors.dark.cardBorder,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: Colors.dark.bg,
          shadowColor: 'transparent',
          elevation: 0,
          borderBottomColor: Colors.dark.cardBorder,
          borderBottomWidth: 1,
          height: 52,
        },
        headerTitleStyle: {
          ...Typography.lg,
          fontWeight: '700',
          color: '#fff',
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Agents',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 22, opacity: focused ? 1 : 0.5 }}>
              {'\u{1F9E0}'}
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: 'Files',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 22, opacity: focused ? 1 : 0.5 }}>
              {'\u{1F4C2}'}
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="pipelines"
        options={{
          title: 'Pipelines',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 22, opacity: focused ? 1 : 0.5 }}>
              {'\u{1F500}'}
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 22, opacity: focused ? 1 : 0.5 }}>
              {'\u2699\uFE0F'}
            </Text>
          ),
        }}
      />
    </Tabs>
  );
}
