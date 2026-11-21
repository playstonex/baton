import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from '../hooks/useThemeColors';
import { Typography, Spacing, Colors, InsetGrouped, iOSGroupedRadius } from '../constants/theme';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { HighlightPressable, ScalePressable } from './Pressables';

/**
 * Shared surface primitives. Every card/button/pill in the app renders
 * through here so surface treatment (fills, borders, press feedback, type)
 * stays consistent across screens.
 *
 * Cards are opaque surfaces. They sit on a static canvas, so a blur behind
 * them has nothing to show; material blur is reserved for bars and overlays
 * that content actually scrolls under.
 */

/** Dark cards need a faint edge against the near-black canvas; light ones don't. */
function cardEdge(c: ThemeColors) {
  return c.isDark
    ? { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.07)' }
    : null;
}

export function GlassCard({
  c,
  style,
  children,
  overlay,
}: {
  c: ThemeColors;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** Painted edge-to-edge inside the card (under content) — attention
   * rails/tints sit flush with the card border, not the content padding. */
  overlay?: React.ReactNode;
}) {
  return (
    <View style={[styles.glassCard, { backgroundColor: c.card }, cardEdge(c), style]}>
      {overlay}
      <View style={styles.glassCardContent}>{children}</View>
    </View>
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
        <Text style={[styles.sectionTitle, { color: c.textTertiary }]} accessibilityRole="header">
          {title}
        </Text>
        {count !== undefined && (
          <Text style={[styles.countText, { color: c.textTertiary }]}>{count}</Text>
        )}
      </View>
      {action && (
        <ScalePressable
          onPress={action.onPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
        >
          <Text style={[styles.sectionActionText, { color: Colors.primary[500] }]}>
            {action.label}
          </Text>
        </ScalePressable>
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
    <View style={[styles.statCard, { backgroundColor: c.card }, cardEdge(c)]}>
      <Text style={[styles.statValue, { color: c.textPrimary }]}>{value}</Text>
      <View style={styles.statBottom}>
        {icon && <Ionicons name={icon as any} size={12} color={accent} />}
        <Text style={[styles.statLabel, { color: c.textTertiary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
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
  const fg =
    variant === 'primary' ? '#ffffff' : variant === 'danger' ? Colors.danger[400] : c.textPrimary;
  const bg =
    variant === 'primary'
      ? Colors.primary[500]
      : variant === 'danger'
        ? Colors.danger[400] + '1f'
        : c.isDark
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(0,0,0,0.05)';
  return (
    <ScalePressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={[
        styles.btnBase,
        { backgroundColor: bg, opacity: isDisabled && !loading ? 0.4 : 1 },
        style,
      ]}
    >
      <View style={styles.btnContent}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          icon && <Ionicons name={icon as any} size={18} color={fg} />
        )}
        {!!label && (
          <Text style={[Typography.subhead, { color: fg, fontWeight: '600' }]}>{label}</Text>
        )}
      </View>
    </ScalePressable>
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
    <View
      style={[
        styles.searchBar,
        { backgroundColor: c.isDark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)' },
      ]}
    >
      <Ionicons name="search" size={16} color={c.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor={c.textTertiary}
        clearButtonMode="while-editing"
        style={[styles.searchInput, { color: c.textPrimary }]}
      />
    </View>
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
    <ScalePressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.pill, { backgroundColor: active ? accent + '20' : c.subtle }]}
    >
      <Text
        style={[
          styles.pillText,
          { color: active ? accent : c.textSecondary, fontWeight: active ? '600' : '500' },
        ]}
      >
        {label}
      </Text>
    </ScalePressable>
  );
}

export function GlassDivider({ c }: { c: ThemeColors }) {
  return <View style={[styles.divider, { backgroundColor: c.separator }]} />;
}

/**
 * Skeleton block for async list content — keeps the layout shape instead of
 * collapsing into a spinner, with a slow pulse so it reads as loading.
 */
export function GlassSkeleton({
  c,
  height = 56,
  radius = 14,
}: {
  c: ThemeColors;
  height?: number;
  radius?: number;
}) {
  const pulse = useSharedValue(0.55);
  React.useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          height,
          borderRadius: radius,
          backgroundColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.08)',
        },
        pulseStyle,
      ]}
    />
  );
}

// ── iOS inset-grouped list ──────────────────────────────────────────────

/**
 * A titled group of rows on a rounded surface, as in iOS Settings. Rows are
 * separated by inset hairlines that start at the text, not the icon.
 */
export function GroupedSection({
  c,
  header,
  footer,
  children,
  style,
  iconRows,
}: {
  c: ThemeColors;
  header?: string;
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rows carry icon tiles: separators start at the title, as in iOS. */
  iconRows?: boolean;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.groupWrap, style]}>
      {header ? (
        <Text style={[styles.groupHeader, { color: c.textTertiary }]} accessibilityRole="header">
          {header}
        </Text>
      ) : null}
      <View style={[styles.groupCard, { backgroundColor: c.card }, cardEdge(c)]}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {row}
            {i < rows.length - 1 && (
              <View
                style={[
                  styles.groupSeparator,
                  { backgroundColor: c.separator, marginLeft: iconRows ? 57 : Spacing.lg },
                ]}
              />
            )}
          </React.Fragment>
        ))}
      </View>
      {footer ? (
        <Text style={[styles.groupFooter, { color: c.textTertiary }]}>{footer}</Text>
      ) : null}
    </View>
  );
}

/**
 * One row in a `GroupedSection`: optional tinted icon tile, title + subtitle,
 * trailing value or accessory, and a chevron when it navigates.
 */
export function GroupedRow({
  c,
  icon,
  iconColor,
  title,
  subtitle,
  value,
  accessory,
  onPress,
  chevron,
  destructive,
  selected,
  accessibilityHint,
}: {
  c: ThemeColors;
  icon?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  accessory?: React.ReactNode;
  onPress?: () => void;
  /** Show a disclosure chevron. Defaults to true when the row is pressable. */
  chevron?: boolean;
  destructive?: boolean;
  /** Shows a checkmark, for single-choice lists. */
  selected?: boolean;
  accessibilityHint?: string;
}) {
  const tint = iconColor ?? Colors.primary[500];
  const showChevron = chevron ?? (!!onPress && selected === undefined && !destructive);
  const content = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: tint }]}>
          <Ionicons name={icon as any} size={16} color="#ffffff" />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text
          style={[Typography.body, { color: destructive ? Colors.danger[400] : c.textPrimary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[Typography.footnote, { color: c.textTertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[Typography.body, { color: c.textTertiary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {selected ? <Ionicons name="checkmark" size={20} color={Colors.primary[500]} /> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={17} color={c.textTertiary} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <HighlightPressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityState={selected !== undefined ? { selected } : undefined}
      accessibilityHint={accessibilityHint}
    >
      {content}
    </HighlightPressable>
  );
}

const styles = StyleSheet.create({
  glassCard: {
    borderRadius: 14,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  glassCardContent: { padding: Spacing.lg, gap: Spacing.md },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: 6,
    marginTop: Spacing.lg,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionTitle: { ...Typography.footnote, textTransform: 'uppercase' },
  countText: { ...Typography.footnote, fontVariant: ['tabular-nums'] },
  sectionActionText: { ...Typography.footnote, fontWeight: '600' },

  statCard: {
    flex: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 2,
    alignItems: 'flex-start',
  },
  statValue: { ...Typography.statValue },
  statBottom: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { ...Typography.caption1 },

  btnBase: {
    minHeight: 48,
    borderRadius: 12,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: Spacing.sm,
    minHeight: 36,
    gap: 6,
  },
  searchInput: { flex: 1, ...Typography.body, paddingVertical: 7 },

  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: 16 },
  pillText: { ...Typography.footnote },

  divider: { height: StyleSheet.hairlineWidth },

  skeleton: { overflow: 'hidden' },

  groupWrap: { marginTop: InsetGrouped.sectionGap },
  groupHeader: {
    ...Typography.footnote,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    marginBottom: 6,
  },
  groupCard: {
    borderRadius: iOSGroupedRadius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  groupFooter: {
    ...Typography.footnote,
    paddingHorizontal: Spacing.lg,
    marginTop: 6,
  },
  groupSeparator: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: InsetGrouped.rowMinHeight,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    gap: Spacing.md,
  },
  rowIcon: {
    width: 29,
    height: 29,
    borderRadius: 7,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
});
