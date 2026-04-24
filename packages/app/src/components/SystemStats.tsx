import { useState, useEffect } from 'react';
import { Card, CardContent, ProgressBar } from '@heroui/react';

interface SystemStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  uptime: number;
  hostname: string;
  platform: string;
  loadAvg: number[];
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function SystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      try {
        const res = await fetch('/api/system/stats');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (mounted) {
          setStats(data);
          setError(false);
          setLoading(false);
        }
      } catch {
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">System Status</h3>
          <div className="text-[13px] text-surface-400">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">System Status</h3>

        <div className="mb-4 font-mono text-xs text-surface-400">
          {stats.hostname} ({stats.platform}) &middot; Uptime: {formatUptime(stats.uptime)} &middot; Load: {stats.loadAvg.map((n) => n.toFixed(2)).join(', ')}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatBar
            label={`CPU (${stats.cpu.cores} cores)`}
            value={`${stats.cpu.usage.toFixed(1)}%`}
            pct={stats.cpu.usage}
            color="accent"
          />
          <StatBar
            label="Memory"
            value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
            pct={stats.memory.percentage}
            color="success"
          />
          <StatBar
            label="Disk"
            value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
            pct={stats.disk.percentage}
            color="warning"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: 'accent' | 'success' | 'warning' }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-surface-700 dark:text-surface-300">{label}</span>
        <span className="font-mono text-xs text-surface-400">{value}</span>
      </div>
      <ProgressBar value={Math.min(100, Math.max(0, pct))} color={color} size="sm" />
    </div>
  );
}
