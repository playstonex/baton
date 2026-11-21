import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import {
  deriveSessionBucket,
  describeSessionStatus,
  type SessionBucket,
  type SessionListItem,
  sessionBucketLabel,
} from '@baton/shared/utils';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CornerRadius, Typography } from '../../constants/theme';
import { UNTITLED_SESSION_LABEL } from '../../lib/sessionTitle';
import { HighlightPressable } from '../Pressables';
import { agentMetaFor, BUCKET_COLOR } from './agentMeta';

export interface SidebarSessionItem extends SessionListItem {
  /** The daemon still has this session open (any status but stopped). */
  live: boolean;
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function PulsingDot({ color, size }: { color: string; size: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}

export function StatusDot({ bucket, size = 9 }: { bucket: SessionBucket; size?: number }) {
  const color = BUCKET_COLOR[bucket];
  if (bucket === 'running') return <PulsingDot color={color} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

interface SessionRowProps {
  item: SidebarSessionItem;
  projectLabel: string;
  selected: boolean;
  onPress: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const SessionRow = React.memo(function SessionRow({
  item,
  projectLabel,
  selected,
  onPress,
  onDelete,
}: SessionRowProps) {
  const c = useThemeColors();
  const meta = agentMetaFor(item.type);
  const bucket = deriveSessionBucket(item.status);
  const urgent = bucket === 'needs_input' || bucket === 'failed';
  const faded = bucket === 'done';
  const title = item.title?.replace(/\s+/g, ' ').trim() || UNTITLED_SESSION_LABEL;
  const statusText = describeSessionStatus(item);
  const statusColor = urgent || bucket === 'running' ? BUCKET_COLOR[bucket] : c.textTertiary;

  return (
    <HighlightPressable
      onPress={() => onPress(item.id)}
      style={[
        styles.row,
        selected && {
          backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.07)',
        },
        faded && styles.faded,
      ]}
    >
      <View style={styles.badgeWrap}>
        <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
          <Ionicons name={meta.icon as any} size={15} color={meta.color} />
        </View>
        {bucket !== 'done' && (
          <View style={[styles.dotRing, { backgroundColor: c.secondaryBg }]}>
            <StatusDot bucket={bucket} />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.topLine}>
          <Text
            style={[styles.project, { color: selected ? c.textPrimary : c.textSecondary }]}
            numberOfLines={1}
          >
            {projectLabel}
          </Text>
          {urgent && (
            <View style={[styles.pill, { backgroundColor: BUCKET_COLOR[bucket] + '26' }]}>
              <Text style={[styles.pillText, { color: BUCKET_COLOR[bucket] }]}>
                {sessionBucketLabel(bucket)}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.title, { color: c.textSecondary }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: statusColor }]} numberOfLines={1}>
          {meta.label} · {statusText} · {formatRelativeTime(item.lastActivity)}
        </Text>
      </View>

      {onDelete && (
        <Pressable onPress={() => onDelete(item.id)} hitSlop={8} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={13} color={c.textTertiary} />
        </Pressable>
      )}
    </HighlightPressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: CornerRadius.medium,
    marginBottom: 2,
    gap: 10,
  },
  faded: { opacity: 0.6 },
  badgeWrap: { width: 32, height: 32 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRing: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    padding: 2,
    borderRadius: 8,
  },
  info: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  project: { ...Typography.subhead, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  pill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  pillText: { fontSize: 10, fontWeight: '700' },
  title: { ...Typography.subhead, fontSize: 13, marginTop: 1 },
  meta: { ...Typography.caption2, fontSize: 11, marginTop: 1 },
  deleteBtn: { padding: 4, opacity: 0.6 },
});
