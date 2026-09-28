import { useState, useEffect } from 'react';
import { Card, ProgressBar } from '../lib/ui.js';
import { usePolling } from '../lib/hooks.js';

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
  }, []);

  usePolling(async () => {
    try {
      const res = await fetch('/api/system/stats');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setStats(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, 5000);

  if (loading) {
    return (
      <Card padding={false} className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-geist-gray-alpha-200">
            <span className="text-sm">📊</span>
          </div>
          <h3 className="text-sm font-semibold text-geist-gray-1000">System Status</h3>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-geist-gray-700">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading…
        </div>
      </Card>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <Card padding={false} className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-geist-blue-100 dark:bg-geist-blue-1000">
            <span className="text-sm">📊</span>
          </div>
          <h3 className="text-sm font-semibold text-geist-gray-1000">System Status</h3>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-sm)] bg-geist-gray-alpha-100 px-6 py-4">
        <div className="flex items-center gap-1.5 text-xs text-geist-gray-800">
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="8" rx="1" />
            <path d="M5 14h6M8 11v3" />
          </svg>
          <span className="font-mono">{stats.hostname}</span>
        </div>
        <span className="text-geist-gray-alpha-500">·</span>
        <span className="text-xs text-geist-gray-800">{stats.platform}</span>
        <span className="text-geist-gray-alpha-500">·</span>
        <span className="text-xs text-geist-gray-800">Uptime: {formatUptime(stats.uptime)}</span>
        <span className="text-geist-gray-alpha-500">·</span>
        <span className="text-xs tabular-nums text-geist-gray-800">Load: {stats.loadAvg.map((n) => n.toFixed(2)).join(', ')}</span>
      </div>

      <div className="grid grid-cols-3 gap-8">
        <StatBar
          label={`CPU (${stats.cpu.cores} cores)`}
          value={`${stats.cpu.usage.toFixed(1)}%`}
          pct={stats.cpu.usage}
          color="blue"
          icon="⚡"
        />
        <StatBar
          label="Memory"
          value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          pct={stats.memory.percentage}
          color="green"
          icon="🧠"
        />
        <StatBar
          label="Disk"
          value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
          pct={stats.disk.percentage}
          color="amber"
          icon="💾"
        />
      </div>
    </Card>
  );
}

function StatBar({ label, value, pct, color, icon }: { label: string; value: string; pct: number; color: 'blue' | 'green' | 'amber'; icon: string }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs">{icon}</span>
          <span className="text-xs font-medium text-geist-gray-800">{label}</span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-geist-gray-700">{value}</span>
      </div>
      <ProgressBar value={Math.min(100, Math.max(0, pct))} color={color} aria-label={label} />
    </div>
  );
}
