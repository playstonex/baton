import { View, Text } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { useThemeColors } from '../hooks/useThemeColors';
import { Typography, Spacing, Colors } from '../constants/theme';

function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
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

/** Capacity meters go green → amber → red by threshold; CPU is activity, so
 * its healthy color is the accent rather than a status green. */
function getUsageColor(pct: number, kind: 'cpu' | 'capacity'): string {
  if (pct > 90) return Colors.danger[400];
  if (pct > 70) return Colors.warning[400];
  return kind === 'cpu' ? Colors.primary[500] : Colors.success[400];
}

/**
 * One slim strip of host telemetry — three micro meters side by side, seated
 * under the server card's hairline. Replaces the old nested "Host Resources"
 * card (hostname header + full-width bars + session badges), which pushed the
 * session lists a full screen down.
 */
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
    <View style={{ flexDirection: 'row', gap: Spacing.md }}>
      <Meter
        c={c}
        label="CPU"
        value={`${(stats.cpu.usage * 100).toFixed(1)}%`}
        pct={stats.cpu.usage * 100}
        kind="cpu"
      />
      <Meter
        c={c}
        label="MEM"
        value={`${formatGB(stats.memory.used)}/${formatGB(stats.memory.total)}`}
        pct={stats.memory.percentage}
        kind="capacity"
      />
      <Meter
        c={c}
        label="DISK"
        value={`${formatGB(stats.disk.used)}/${formatGB(stats.disk.total)}`}
        pct={stats.disk.percentage}
        kind="capacity"
      />
    </View>
  );
}

function Meter({
  label,
  value,
  pct,
  kind,
  c,
}: {
  label: string;
  value: string;
  pct: number;
  kind: 'cpu' | 'capacity';
  c: ReturnType<typeof useThemeColors>;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
        <Text style={[Typography.overline, { color: c.textTertiary, fontSize: 10 }]}>{label}</Text>
        <Text
          style={[Typography.mono, { fontSize: 10, color: c.textTertiary }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: c.elevated, overflow: 'hidden' }}>
        <View
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor: getUsageColor(clamped, kind),
            width: `${clamped}%`,
          }}
        />
      </View>
    </View>
  );
}
