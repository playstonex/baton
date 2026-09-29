import { useState, useEffect } from 'react';
import { Card, ProgressBar } from '../lib/ui.js';
import { IconActivity, IconCpu, IconDisk, IconMemory } from '../lib/icons.js';
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
      <Card>
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-raised text-muted">
            <IconActivity className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-[13px] font-semibold text-fg">System status</h3>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted">
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
    <Card>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent-soft text-accent-hover">
          <IconActivity className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-[13px] font-semibold text-fg">System status</h3>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
        <span className="text-fg-2">{stats.hostname}</span>
        <span className="text-line-strong">·</span>
        <span>{stats.platform}</span>
        <span className="text-line-strong">·</span>
        <span>up {formatUptime(stats.uptime)}</span>
        <span className="text-line-strong">·</span>
        <span className="tabular-nums">load {stats.loadAvg.map((n) => n.toFixed(2)).join(' ')}</span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <StatBar
          label={`CPU (${stats.cpu.cores} cores)`}
          value={`${stats.cpu.usage.toFixed(1)}%`}
          pct={stats.cpu.usage}
          color="blue"
          icon={<IconCpu className="h-3.5 w-3.5" />}
        />
        <StatBar
          label="Memory"
          value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          pct={stats.memory.percentage}
          color="green"
          icon={<IconMemory className="h-3.5 w-3.5" />}
        />
        <StatBar
          label="Disk"
          value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
          pct={stats.disk.percentage}
          color="amber"
          icon={<IconDisk className="h-3.5 w-3.5" />}
        />
      </div>
    </Card>
  );
}

function StatBar({ label, value, pct, color, icon }: { label: string; value: string; pct: number; color: 'blue' | 'green' | 'amber'; icon: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted">
          {icon}
          <span className="text-xs font-medium text-fg-2">{label}</span>
        </div>
        <span className="truncate font-mono text-[11px] tabular-nums text-meta">{value}</span>
      </div>
      <ProgressBar value={Math.min(100, Math.max(0, pct))} color={color} aria-label={label} />
    </div>
  );
}
