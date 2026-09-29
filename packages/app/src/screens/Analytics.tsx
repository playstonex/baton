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
    return <LoadingSpinner text="Loading analytics…" />;
  }

  const scoreColor = health
    ? health.score >= 80
      ? 'text-success'
      : health.score >= 50
        ? 'text-warn'
        : 'text-danger'
    : 'text-muted';

  const maxEvents = Math.max(...hourly.map((h) => h.totalEvents), 1);

  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" description="Agent performance metrics and health monitoring" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Health score" value={health?.score ?? '—'} suffix="/100" valueClassName={scoreColor} />
        <MetricCard label="Success rate" value={health?.successRate ?? '—'} suffix="%" />
        <MetricCard label="Avg latency" value={health?.avgLatencyMs ?? '—'} suffix="ms" />
        <MetricCard
          label="Errors (24h)"
          value={health?.errorCount24h ?? 0}
          valueClassName={health && health.errorCount24h > 0 ? 'text-danger' : undefined}
        />
      </div>

      <Card>
        <div className="px-5 pb-2 pt-4">
          <div className="text-[13px] font-semibold text-fg">Events over time (24h)</div>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-accent" /> tool calls
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-danger" /> errors
            </span>
          </div>
        </div>
        <div className="px-5 pb-5 pt-2">
          {hourly.length === 0 ? (
            <EmptyState
              icon={<IconActivity className="h-5 w-5" />}
              title="No event data yet"
              description="Start an agent to begin collecting analytics."
            />
          ) : (
            <div className="flex items-end gap-1.5 overflow-x-auto" style={{ minHeight: 160 }}>
              {hourly.map((h) => {
                const height = (h.totalEvents / maxEvents) * 100;
                return (
                  <div
                    key={h.hour}
                    className="group relative flex min-w-[28px] flex-1 flex-col items-center"
                  >
                    <div
                      className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-raised transition-all duration-200"
                      style={{ height: `${Math.max(height, 2)}%`, minHeight: 2 }}
                    >
                      <div
                        className="w-full bg-danger transition-all"
                        style={{ height: `${(h.errors / h.totalEvents) * 100}%` }}
                      />
                      <div
                        className="w-full bg-accent transition-all"
                        style={{ height: `${(h.toolCalls / h.totalEvents) * 100}%` }}
                      />
                    </div>
                    <span className="mt-1 font-mono text-[9px] tabular-nums text-meta">{h.hour.slice(-5)}</span>
                    <div className="pointer-events-none absolute -top-16 left-1/2 z-10 -translate-x-1/2 rounded-sm border border-line bg-surface px-2.5 py-1.5 font-mono text-[10px] text-fg-2 opacity-0 shadow-[var(--shadow-popover)] transition-opacity duration-150 group-hover:opacity-100">
                      <div>{h.totalEvents} events</div>
                      <div>{h.toolCalls} tools</div>
                      {h.errors > 0 && <div className="text-danger">{h.errors} errors</div>}
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
