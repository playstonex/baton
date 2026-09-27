import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography, Spacing, CornerRadius, Colors } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useConnectionStore } from '../stores/connection';

/**
 * Top banner shown when the daemon connection drops. Reads the connection
 * store so it re-renders on any state change. Positioned below the nav bar
 * using safe-area insets. Auto-hidden once reconnected.
 *
 * Only renders when a host is configured (activeHostId set) — we don't want
 * to nag users who haven't paired yet (the Settings screen handles that case).
 */
export function OfflineBanner() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const connected = useConnectionStore((s) => s.connected);
  const activeHostId = useConnectionStore((s) => s.activeHostId);

  // Don't show before any host is configured — that's the Settings flow's job.
  if (connected || !activeHostId) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        {
          top: insets.top + 48,
          width: Math.min(width - Spacing.lg * 2, 480),
          left: (width - Math.min(width - Spacing.lg * 2, 480)) / 2,
        },
      ]}
    >
      <BlurView
        tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
        intensity={60}
        style={[
          styles.banner,
          {
            backgroundColor: c.isDark ? 'rgba(220,80,70,0.18)' : 'rgba(220,80,70,0.10)',
            borderColor: c.isDark ? 'rgba(220,80,70,0.35)' : 'rgba(220,80,70,0.25)',
          },
        ]}
      >
        <View style={styles.dot} />
        <Text style={[Typography.footnote, styles.text, { color: c.textPrimary }]}>
          Disconnected — retrying
        </Text>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 50,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: CornerRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.danger[500],
  },
  text: {
    fontWeight: '600',
  },
});
