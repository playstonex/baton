import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from '../hooks/useThemeColors';
import { Typography, Spacing, Glass, Colors } from '../constants/theme';

export function GlassCard({
  c,
  style,
  children,
  blurIntensity,
}: {
  c: ThemeColors;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  blurIntensity?: number;
}) {
  return (
    <BlurView
      tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
      intensity={blurIntensity ?? Glass.blur.card}
      style={[styles.glassCard, style]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: c.isDark ? Glass.opacity.dark.surface : Glass.opacity.light.surface,
            borderRadius: 16,
          },
        ]}
        pointerEvents="none"
      />
      <View style={styles.glassCardContent}>{children}</View>
    </BlurView>
  );
}

export function GlassSectionHeader({
  c,
  title,
  count,
  action,
}: {
  c: ThemeColors;
  title: string;
  count?: number;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <View style={[styles.sectionAccent, { backgroundColor: Colors.primary[500] }]} />
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>{title}</Text>
        {count !== undefined && (
          <View style={[styles.countBadge, { backgroundColor: c.subtle }]}>
            <Text style={[styles.countText, { color: c.textTertiary }]}>{count}</Text>
          </View>
        )}
      </View>
      {action && (
        <Pressable
          onPress={action.onPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => [styles.sectionAction, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.sectionActionText, { color: Colors.primary[500] }]}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function GlassStatCard({
  c,
  value,
  label,
  icon,
  color,
}: {
  c: ThemeColors;
  value: string | number;
  label: string;
  icon?: string;
  color?: string;
}) {
  const accent = color ?? Colors.primary[500];
  return (
    <BlurView
      tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
      intensity={Glass.blur.card}
      style={styles.statCard}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: c.isDark ? Glass.opacity.dark.surface : Glass.opacity.light.surface,
            borderRadius: 14,
          },
        ]}
        pointerEvents="none"
      />
      <View style={[styles.statGlow, { backgroundColor: accent + '18' }]} />
      <Text style={[styles.statValue, { color: c.textPrimary }]}>{value}</Text>
      <View style={styles.statBottom}>
        {icon && <Ionicons name={icon as any} size={12} color={accent} />}
        <Text style={[styles.statLabel, { color: c.textTertiary }]}>{label}</Text>
      </View>
    </BlurView>
  );
}

export function GlassButton({
  c,
  label,
  onPress,
  disabled,
  loading,
  icon,
  variant = 'primary',
  style,
}: {
  c: ThemeColors;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const accentColor = variant === 'danger' ? '#FF3B30' : variant === 'secondary' ? c.textSecondary : Colors.primary[500];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [styles.btnBase, style, { opacity: isDisabled ? 0.4 : pressed ? 0.9 : 1 }]}
    >
      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={Glass.blur.card}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor:
              variant === 'primary'
                ? Colors.primary[500] + '20'
                : variant === 'danger'
                  ? '#FF3B30' + '15'
                  : c.isDark
                    ? Glass.opacity.dark.subtle
                    : Glass.opacity.light.subtle,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor:
              variant === 'primary'
                ? c.isDark
                  ? Glass.opacity.dark.borderActive
                  : Glass.opacity.light.borderActive
                : c.isDark
                  ? Glass.opacity.dark.border
                  : Glass.opacity.light.border,
          },
        ]}
        pointerEvents="none"
      />
      <View style={styles.btnContent}>
        {icon && !loading && <Ionicons name={icon as any} size={18} color={accentColor} />}
        <Text
          style={[
            Typography.subhead,
            {
              color: variant === 'primary' ? Colors.primary[500] : variant === 'danger' ? '#FF3B30' : c.textPrimary,
              fontWeight: '600',
            },
          ]}
        >
          {loading ? '...' : label}
        </Text>
      </View>
    </Pressable>
  );
}

export function GlassSearchBar({
  c,
  value,
  onChangeText,
  placeholder,
}: {
  c: ThemeColors;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <BlurView
      tint={c.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
      intensity={Glass.blur.card}
      style={styles.searchBar}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: c.isDark ? Glass.opacity.dark.subtle : Glass.opacity.light.subtle,
            borderRadius: 12,
          },
        ]}
        pointerEvents="none"
      />
      <Ionicons name="search" size={16} color={c.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor={c.textTertiary}
        style={[styles.searchInput, { color: c.textPrimary }]}
      />
    </BlurView>
  );
}

export function GlassPill({
  c,
  label,
  active,
  onPress,
  color,
}: {
  c: ThemeColors;
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const accent = color ?? Colors.primary[500];
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, { backgroundColor: active ? accent + '20' : c.subtle }]}
    >
      <Text style={[styles.pillText, { color: active ? accent : c.textSecondary, fontWeight: active ? '600' : '500' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function GlassDivider({ c }: { c: ThemeColors }) {
  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glassCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  glassCardContent: { padding: Spacing.lg, gap: Spacing.md },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionAccent: { width: 3, height: 18, borderRadius: 2 },
  sectionTitle: { ...Typography.subhead, fontWeight: '600' },
  countBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  countText: { fontSize: 11, fontWeight: '600' },
  sectionAction: {},
  sectionActionText: { ...Typography.footnote, fontWeight: '600' },

  statCard: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    gap: 2,
    alignItems: 'center',
  },
  statGlow: { position: 'absolute', top: -20, right: -20, width: 60, height: 60, borderRadius: 30 },
  statValue: { ...Typography.title2, fontWeight: '700' },
  statBottom: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { ...Typography.caption2 },

  btnBase: { minHeight: 48, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    minHeight: 40,
    gap: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.subhead, paddingVertical: Spacing.sm },

  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: 16 },
  pillText: { ...Typography.caption1 },

  divider: { height: StyleSheet.hairlineWidth },
});
