import { View, Text } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  Typography,
  Spacing,
  CornerRadius,
  iOSGroupedRadius,
  Colors,
} from '../constants/theme';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface HostStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  uptime: number;
  hostname: string;
  platform: string;
  sessions: {
    active: number;
    stopped: number;
    totalOutputEntries: number;
    totalEventEntries: number;
    estimatedMemoryMB: number;
  };
}

function getUsageColor(pct: number): string {
  if (pct > 90) return Colors.danger[400];
  if (pct > 70) return Colors.warning[400];
  return Colors.success[400];
}

function StatRow({ label, value, percentage, color }: { label: string; value: string; percentage: number; color: string }) {
  const c = useThemeColors();
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[Typography.footnote, { color: c.textSecondary }]}>{label}</Text>
        <Text style={[Typography.caption1, { color: c.textTertiary, fontFamily: 'Courier' }]}>{value}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.elevated }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: color, width: `${Math.min(100, Math.max(0, percentage))}%` }} />
      </View>
    </View>
  );
}

function MetricBadge({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  const c = useThemeColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={[Typography.title3, { color: c.textPrimary, fontWeight: '700' }]}>{value}</Text>
      <Text style={[Typography.caption2, { color: c.textTertiary }]}>{label}</Text>
      <Text style={[Typography.caption2, { color: c.textTertiary, fontSize: 10 }]}>{sublabel}</Text>
    </View>
  );
}

export function ResourceMonitor({ connected }: { connected: boolean }) {
  const [stats, setStats] = useState<HostStats | null>(null);
  const c = useThemeColors();

  const fetchStats = useCallback(async () => {
    if (!connected) return;
    try {
      const data = await apiFetch<HostStats>('/api/system/stats');
      setStats(data);
    } catch {
    }
  }, [connected]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (!connected || !stats) return null;

  return (
    <>
      <Text
        style={[
          Typography.caption1,
          { color: c.textTertiary, textTransform: 'uppercase', marginTop: Spacing.sm },
        ]}
      >
        Host Resources
      </Text>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: iOSGroupedRadius,
          padding: Spacing.lg,
          gap: Spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
            {stats.hostname}
          </Text>
          <Text style={[Typography.caption2, { color: c.textTertiary }]}>
            {stats.platform} · {formatUptime(stats.uptime)}
          </Text>
        </View>

        <StatRow label="CPU" value={`${(stats.cpu.usage * 100).toFixed(0)}%`} percentage={stats.cpu.usage * 100} color={Colors.primary[500]} />
        <StatRow label="Memory" value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`} percentage={stats.memory.percentage} color={getUsageColor(stats.memory.percentage)} />
        <StatRow label="Disk" value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`} percentage={stats.disk.percentage} color={getUsageColor(stats.disk.percentage)} />

        <View style={{ height: 1, backgroundColor: c.separator }} />

        <View style={{ flexDirection: 'row', gap: Spacing.lg }}>
          <MetricBadge label="Sessions" value={`${stats.sessions.active}`} sublabel="active" />
          <MetricBadge label="Stopped" value={`${stats.sessions.stopped}`} sublabel="stopped" />
          <MetricBadge label="History" value={`${stats.sessions.estimatedMemoryMB}`} sublabel="MB est." />
        </View>
      </View>
    </>
  );
}
