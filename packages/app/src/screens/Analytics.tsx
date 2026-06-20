import { useEffect, useState, useCallback } from 'react';
import { wsService } from '../services/websocket.js';
import { PageHeader, Card, MetricCard, EmptyState, LoadingSpinner } from '../lib/ui.js';
import { IconActivity } from '../lib/icons.js';
import { usePolling } from '../lib/hooks.js';

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
  }, [fetchData]);

  usePolling(fetchData, 30000);

  if (loading) {
    return <LoadingSpinner text="Loading analytics..." />;
  }

  const scoreColor = health
    ? health.score >= 80
      ? 'text-green-500'
      : health.score >= 50
        ? 'text-amber-500'
        : 'text-red-500'
    : 'text-gray-400';

  const maxEvents = Math.max(...hourly.map((h) => h.totalEvents), 1);

  return (
    <div className="space-y-10">
      <PageHeader title="Analytics" description="Agent performance metrics and health monitoring" />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Health Score" value={health?.score ?? '—'} suffix="/100" valueClassName={scoreColor} />
        <MetricCard label="Success Rate" value={health?.successRate ?? '—'} suffix="%" />
        <MetricCard label="Avg Latency" value={health?.avgLatencyMs ?? '—'} suffix="ms" />
        <MetricCard label="Errors (24h)" value={health?.errorCount24h ?? 0} valueClassName={health && health.errorCount24h > 0 ? 'text-red-500' : undefined} />
      </div>

      <Card>
        <div className="px-6 pb-2 pt-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Events Over Time (24h)
          </div>
        </div>
        <div className="px-6 pb-5">
          {hourly.length === 0 ? (
            <EmptyState
              icon={<IconActivity className="h-6 w-6 text-gray-400" />}
              title="No event data yet"
              description="Start an agent to begin collecting analytics."
            />
          ) : (
            <div className="flex items-end gap-1.5 overflow-x-auto" style={{ minHeight: 160 }}>
              {hourly.map((h) => {
                const height = (h.totalEvents / maxEvents) * 100;
                return (
                  <div key={h.hour} className="group relative flex min-w-[28px] flex-1 flex-col items-center">
                    <div
                      className="w-full rounded-t bg-primary-100 dark:bg-primary-900/40 transition-all duration-200"
                      style={{ height: `${Math.max(height, 2)}%`, minHeight: 2 }}
                    >
                      <div
                        className="rounded-t bg-primary-500 w-full transition-all"
                        style={{ height: `${(h.toolCalls / h.totalEvents) * 100}%` }}
                      />
                      <div
                        className="bg-danger-500 w-full transition-all"
                        style={{ height: `${(h.errors / h.totalEvents) * 100}%` }}
                      />
                    </div>
                    <span className="mt-1 text-[9px] text-gray-400">
                      {h.hour.slice(-5)}
                    </span>
                    <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <div>{h.totalEvents} events</div>
                      <div>{h.toolCalls} tools</div>
                      {h.errors > 0 && <div className="text-red-400">{h.errors} errors</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
