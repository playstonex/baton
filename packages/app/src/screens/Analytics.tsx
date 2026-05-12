import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@heroui/react';
import { wsService } from '../services/websocket.js';

interface HealthScore {
  score: number;
  successRate: number;
  avgLatencyMs: number;
  activeAgents: number;
  errorCount24h: number;
}

interface HourlyStats {
  hour: string;
  totalEvents: number;
  toolCalls: number;
  errors: number;
  avgDurationMs: number | null;
}

export function AnalyticsScreen() {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [hourly, setHourly] = useState<HourlyStats[]>([]);
  const [loading, setLoading] = useState(true);

  const httpUrl = wsService.httpUrl;

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, hourlyRes] = await Promise.all([
        fetch(`${httpUrl}/api/analytics/health`),
        fetch(`${httpUrl}/api/analytics/hourly?hours=24`),
      ]);
      if (healthRes.ok) setHealth(await healthRes.json());
      if (hourlyRes.ok) setHourly(await hourlyRes.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, [httpUrl]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  const scoreColor = health
    ? health.score >= 80
      ? 'text-success-500'
      : health.score >= 50
        ? 'text-warning-500'
        : 'text-danger-500'
    : 'text-surface-400';

  const maxEvents = Math.max(...hourly.map((h) => h.totalEvents), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Analytics</h1>
        <p className="mt-1 text-sm text-surface-500">Agent performance metrics and health monitoring</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Health Score" value={health?.score ?? '—'} suffix="/100" valueClassName={scoreColor} />
        <MetricCard label="Success Rate" value={health?.successRate ?? '—'} suffix="%" />
        <MetricCard label="Avg Latency" value={health?.avgLatencyMs ?? '—'} suffix="ms" />
        <MetricCard label="Errors (24h)" value={health?.errorCount24h ?? 0} valueClassName={health && health.errorCount24h > 0 ? 'text-danger-500' : undefined} />
      </div>

      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300">
            Events Over Time (24h)
          </h2>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {hourly.length === 0 ? (
            <div className="py-12 text-center text-sm text-surface-400">
              No event data yet. Start an agent to begin collecting analytics.
            </div>
          ) : (
            <div className="flex items-end gap-1 overflow-x-auto" style={{ minHeight: 160 }}>
              {hourly.map((h) => {
                const height = (h.totalEvents / maxEvents) * 100;
                const errorPct = h.totalEvents > 0 ? (h.errors / h.totalEvents) * 100 : 0;
                const toolPct = h.totalEvents > 0 ? (h.toolCalls / h.totalEvents) * 100 : 0;
                return (
                  <div key={h.hour} className="group relative flex min-w-[28px] flex-1 flex-col items-center">
                    <div
                      className="w-full rounded-t bg-primary-100 dark:bg-primary-900/40 transition-all duration-200"
                      style={{ height: `${Math.max(height, 2)}%`, minHeight: 2 }}
                    >
                      <div
                        className="rounded-t bg-primary-500 w-full transition-all"
                        style={{ height: `${toolPct}%` }}
                      />
                      <div
                        className="bg-danger-500 w-full transition-all"
                        style={{ height: `${errorPct}%` }}
                      />
                    </div>
                    <span className="mt-1 text-[9px] text-surface-400">
                      {h.hour.slice(-5)}
                    </span>
                    <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 rounded bg-surface-800 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <div>{h.totalEvents} events</div>
                      <div>{h.toolCalls} tools</div>
                      {h.errors > 0 && <div className="text-danger-400">{h.errors} errors</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  valueClassName,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-surface-400">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${valueClassName ?? 'text-surface-900 dark:text-white'}`}>
          {value}
          {suffix && <span className="ml-0.5 text-sm font-normal text-surface-400">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
