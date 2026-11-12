import { useEffect, useState } from 'react';
import type { ModelUsageReport, UsageWindow } from '@baton/shared';

function formatResetTime(isoString?: string | null): string {
  if (!isoString) return '';
  const target = new Date(isoString).getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'Resetting now';

  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return `in ${days}d ${remHours}h`;
  }
  if (hours > 0) {
    const remMins = mins % 60;
    return `in ${hours}h ${remMins}m`;
  }
  return `in ${mins}m`;
}

function getTone(pct: number): { text: string; bg: string; dot: string } {
  if (pct >= 90) return { text: 'text-danger', bg: 'bg-danger/10', dot: 'bg-danger' };
  if (pct >= 70) return { text: 'text-warn', bg: 'bg-warn-soft', dot: 'bg-warn' };
  return { text: 'text-success', bg: 'bg-success-soft', dot: 'bg-success' };
}

export function UsagePill() {
  const [report, setReport] = useState<ModelUsageReport | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let unmounted = false;

    async function load() {
      try {
        const res = await fetch('/api/system/usage');
        if (res.ok) {
          const data = (await res.json()) as ModelUsageReport;
          if (!unmounted && data.available) {
            setReport(data);
          }
        }
      } catch {
        // ignore offline or failed checks
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      unmounted = true;
      clearInterval(interval);
    };
  }, []);

  if (!report?.available || !report.fiveHour) {
    return null;
  }

  const fiveHour = report.fiveHour;
  const sevenDay = report.sevenDay;
  const tone = getTone(fiveHour.utilization);

  return (
    <div className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-full border border-line-soft ${tone.bg} px-2.5 py-1 font-mono transition-colors hover:brightness-105`}
        title="Claude Quota & Rate Limit (Click for details)"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="font-medium text-fg">5h</span>
        <span className={`font-semibold ${tone.text}`}>{Math.round(fiveHour.utilization)}%</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-64 rounded-md border border-line-soft bg-surface p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between border-b border-line-soft pb-1.5">
              <span className="font-medium text-fg">Model Quota</span>
              <span className="text-[11px] text-muted">{report.subscription ?? 'Claude'}</span>
            </div>

            <div className="space-y-3 pt-1">
              <WindowRow label="5-Hour Session" window={fiveHour} />
              {sevenDay && <WindowRow label="7-Day All Models" window={sevenDay} />}
              {report.sevenDayOpus && <WindowRow label="7-Day Opus" window={report.sevenDayOpus} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WindowRow({ label, window }: { label: string; window: UsageWindow }) {
  const tone = getTone(window.utilization);
  const resetText = formatResetTime(window.resetsAt);

  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className={`font-mono font-medium ${tone.text}`}>
          {Math.round(window.utilization)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${tone.dot}`}
          style={{ width: `${Math.min(100, Math.max(0, window.utilization))}%` }}
        />
      </div>
      {resetText && (
        <div className="mt-0.5 text-right text-[10px] text-meta">Resets {resetText}</div>
      )}
    </div>
  );
}
