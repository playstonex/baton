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
      <Card className="border border-surface-200 shadow-sm dark:border-surface-700">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800">
              <span className="text-sm">📊</span>
            </div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">System Status</h3>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-surface-400">
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <Card className="overflow-hidden border border-surface-200 shadow-sm dark:border-surface-700">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/50">
              <span className="text-sm">📊</span>
            </div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">System Status</h3>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-surface-50 px-4 py-2.5 dark:bg-surface-800/50">
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="8" rx="1" />
              <path d="M5 14h6M8 11v3" />
            </svg>
            <span className="font-mono">{stats.hostname}</span>
          </div>
          <span className="text-surface-200 dark:text-surface-700">·</span>
          <span className="text-xs text-surface-500">{stats.platform}</span>
          <span className="text-surface-200 dark:text-surface-700">·</span>
          <span className="text-xs text-surface-500">Uptime: {formatUptime(stats.uptime)}</span>
          <span className="text-surface-200 dark:text-surface-700">·</span>
          <span className="text-xs tabular-nums text-surface-500">Load: {stats.loadAvg.map((n) => n.toFixed(2)).join(', ')}</span>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <StatBar
            label={`CPU (${stats.cpu.cores} cores)`}
            value={`${stats.cpu.usage.toFixed(1)}%`}
            pct={stats.cpu.usage}
            color="accent"
            icon="⚡"
          />
          <StatBar
            label="Memory"
            value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
            pct={stats.memory.percentage}
            color="success"
            icon="🧠"
          />
          <StatBar
            label="Disk"
            value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
            pct={stats.disk.percentage}
            color="warning"
            icon="💾"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBar({ label, value, pct, color, icon }: { label: string; value: string; pct: number; color: 'accent' | 'success' | 'warning'; icon: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{icon}</span>
          <span className="text-xs font-medium text-surface-700 dark:text-surface-300">{label}</span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-surface-400">{value}</span>
      </div>
      <ProgressBar value={Math.min(100, Math.max(0, pct))} color={color} size="sm" aria-label={label} />
    </div>
  );
}
