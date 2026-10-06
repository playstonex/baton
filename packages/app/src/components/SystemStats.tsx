import { useState, useEffect } from 'react';
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
  return `${gb.toFixed(1)}G`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Capacity meters go green → amber → red by threshold; CPU is activity, so
 * its healthy color is the accent rather than a status green.
 */
function meterColor(pct: number, kind: 'cpu' | 'capacity'): string {
  const token =
    pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : kind === 'cpu' ? 'accent' : 'success';
  return `var(--color-${token})`;
}

/**
 * One slim strip of host telemetry — identity line on the left, three micro
 * meters on the right. Sits between the page header and the session lists;
 * disappears entirely when the daemon stops answering.
 */
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
      <div
        className="mb-7 flex h-[46px] items-center gap-4 rounded-md border border-line-soft bg-surface px-4"
        aria-hidden="true"
      >
        <div className="h-2 w-64 animate-pulse rounded bg-raised" />
        <div className="ml-auto flex gap-5">
          <div className="h-2 w-24 animate-pulse rounded bg-raised" />
          <div className="h-2 w-24 animate-pulse rounded bg-raised" />
          <div className="h-2 w-24 animate-pulse rounded bg-raised" />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <div className="mb-7 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line-soft bg-surface px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-mono text-[11.5px] whitespace-nowrap text-muted">
        <IconActivity className="h-3.5 w-3.5 shrink-0 text-meta" />
        <span className="shrink-0 font-medium text-fg-2">{stats.hostname}</span>
        <span className="text-line-strong">·</span>
        <span className="truncate">{stats.platform}</span>
        <span className="text-line-strong">·</span>
        <span className="shrink-0">up {formatUptime(stats.uptime)}</span>
        <span className="text-line-strong">·</span>
        <span className="shrink-0 tabular-nums">
          load {stats.loadAvg.map((n) => n.toFixed(2)).join(' ')}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        <Meter
          icon={<IconCpu className="h-3 w-3" />}
          label="CPU"
          value={`${(stats.cpu.usage * 100).toFixed(1)}%`}
          pct={stats.cpu.usage * 100}
          kind="cpu"
        />
        <Meter
          icon={<IconMemory className="h-3 w-3" />}
          label="MEM"
          value={`${formatBytes(stats.memory.used)}/${formatBytes(stats.memory.total)}`}
          pct={stats.memory.percentage}
          kind="capacity"
        />
        <Meter
          icon={<IconDisk className="h-3 w-3" />}
          label="DISK"
          value={`${formatBytes(stats.disk.used)}/${formatBytes(stats.disk.total)}`}
          pct={stats.disk.percentage}
          kind="capacity"
        />
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  pct,
  kind,
  icon,
}: {
  label: string;
  value: string;
  pct: number;
  kind: 'cpu' | 'capacity';
  icon: React.ReactNode;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-2">
        <span className="text-muted">{icon}</span>
        {label}
      </span>
      <span className="h-[3px] w-14 overflow-hidden rounded-full bg-line-soft">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{ width: `${clamped}%`, background: meterColor(clamped, kind) }}
        />
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-meta">{value}</span>
    </div>
  );
}
