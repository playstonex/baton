import type { ReactNode } from 'react';
import { IconChevronRight, StatusDot } from './icons.js';
export { StatusDot };

/* ─── Page Header ─── */
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
        {title}
      </h1>
      {description && (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
    </div>
  );
}

/* ─── Section Header ─── */
export function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      {children}
    </div>
  );
}

/* ─── Breadcrumbs ─── */
export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string; onClick?: () => void }>;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-gray-400">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <IconChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600" />}
          {item.onClick || item.href ? (
            <button
              type="button"
              onClick={item.onClick}
              className="transition-colors hover:text-blue-600 dark:hover:text-blue-400"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-gray-600 dark:text-gray-300">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ─── Card Container ─── */
export function Card({
  children,
  className = '',
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${padding ? 'p-7' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Empty State ─── */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-20 text-center dark:border-gray-700 dark:bg-gray-900/50">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
        {icon}
      </div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h4>
      {description && (
        <p className="mt-1 text-xs text-gray-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ─── Metric Card ─── */
export function MetricCard({
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
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className={`mt-1.5 text-2xl font-bold tabular-nums ${valueClassName ?? 'text-gray-900 dark:text-white'}`}
      >
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

/* ─── Status Badge ─── */
export function StatusBadge({
  status,
  dot = true,
}: {
  status: string;
  dot?: boolean;
}) {
  const styles: Record<string, { bg: string; text: string; dot: string }> = {
    running: { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
    thinking: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
    executing: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
    idle: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-400' },
    waiting_input: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
    stopped: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
    error: { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
    starting: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-400' },
    completed: { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
    pending: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' },
    failed: { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
    skipped: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' },
    connected: { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
    disconnected: { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  };
  const s = styles[status] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Loading Spinner ─── */
export function LoadingSpinner({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="text-sm text-gray-400">{text}</span>
      </div>
    </div>
  );
}

/* ─── Back Button ─── */
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 12L6 8l4-4" />
      </svg>
      Back
    </button>
  );
}

/* ─── Status Alert ─── */
export function StatusAlert({
  type,
  title,
  message,
}: {
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}) {
  const styles = {
    success: { border: 'border-green-200 dark:border-green-800', bg: 'bg-green-50 dark:bg-green-950/25', titleText: 'text-green-700 dark:text-green-400', msgText: 'text-green-700/80 dark:text-green-400/85' },
    error: { border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-950/25', titleText: 'text-red-700 dark:text-red-400', msgText: 'text-red-700/80 dark:text-red-400/85' },
    info: { border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-950/25', titleText: 'text-blue-700 dark:text-blue-400', msgText: 'text-blue-700/80 dark:text-blue-400/85' },
  };
  const s = styles[type];
  return (
    <div className={`rounded-lg border px-4 py-3 ${s.border} ${s.bg}`}>
      {title && <div className={`text-sm font-medium ${s.titleText}`}>{title}</div>}
      <div className={`mt-0.5 text-sm ${s.msgText}`}>{message}</div>
    </div>
  );
}
