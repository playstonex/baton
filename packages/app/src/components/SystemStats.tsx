import { useState, useEffect } from 'react';

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
      } catch (err) {
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
      <div
        style={{
          marginBottom: 24,
          padding: 20,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>System Status</h3>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Loading...</div>
      </div>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <div
      style={{
        marginBottom: 24,
        padding: 20,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>System Status</h3>
      
      <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace', marginBottom: 16 }}>
        {stats.hostname} ({stats.platform}) • Uptime: {formatUptime(stats.uptime)} • Load: {stats.loadAvg.map(n => n.toFixed(2)).join(', ')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>CPU ({stats.cpu.cores} cores)</span>
            <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{stats.cpu.usage.toFixed(1)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#3b82f6', width: `${Math.min(100, Math.max(0, stats.cpu.usage))}%` }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Memory</span>
            <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
              {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#22c55e', width: `${Math.min(100, Math.max(0, stats.memory.percentage))}%` }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Disk</span>
            <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
              {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#f59e0b', width: `${Math.min(100, Math.max(0, stats.disk.percentage))}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
