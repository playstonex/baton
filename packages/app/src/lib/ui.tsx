import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { IconChevronRight, StatusDot } from './icons.js';
export { StatusDot };

/* ─────────────────────────────────────────────
   Button — Linear component voice
   primary: brand indigo fill · white label
   secondary: ghost control — translucent field + hairline border
   tertiary: quiet text control
   error: quiet danger — tinted until hover
   Sizes: sm 28px / md 32px / lg 36px
   ───────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'error';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:focus-ring disabled:cursor-not-allowed select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-active disabled:bg-raised disabled:text-meta',
  secondary:
    'border border-line bg-field text-fg-2 hover:bg-raised hover:text-fg active:bg-active disabled:text-meta disabled:bg-transparent',
  tertiary: 'text-fg-2 hover:bg-raised hover:text-fg active:bg-active disabled:text-meta',
  error:
    'border border-danger/30 bg-danger-soft text-danger hover:bg-danger hover:border-danger hover:text-white disabled:border-line disabled:bg-transparent disabled:text-meta',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-8 px-3 text-[13px]',
  lg: 'h-9 px-3.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Input — translucent field, hairline border
   Sizes: sm 28px / md 32px / lg 36px
   ───────────────────────────────────────────── */
type InputSize = 'sm' | 'md' | 'lg';

const INPUT_SIZES: Record<InputSize, string> = {
  sm: 'h-7 text-[13px]',
  md: 'h-8 text-[13px]',
  lg: 'h-9 text-sm',
};

export function Input({
  size = 'md',
  className = '',
  ...props
}: { size?: InputSize } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return (
    <input
      className={`w-full rounded-sm border border-line bg-field px-2.5 text-fg placeholder:text-meta transition-colors duration-150 hover:border-line-strong focus:border-accent focus-visible:focus-ring focus:outline-none disabled:opacity-50 ${INPUT_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/* ─────────────────────────────────────────────
   ProgressBar — hairline track + accent fill
   ───────────────────────────────────────────── */
type ProgressColor = 'blue' | 'green' | 'amber' | 'red';

const PROGRESS_FILLS: Record<ProgressColor, string> = {
  blue: 'bg-accent',
  green: 'bg-success',
  amber: 'bg-warn',
  red: 'bg-danger',
};

export function ProgressBar({
  value,
  color = 'blue',
  className = '',
  ...props
}: { value: number; color?: ProgressColor } & React.HTMLAttributes<HTMLDivElement>) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-line-soft ${className}`} {...props}>
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${PROGRESS_FILLS[color]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Chip — pill; neutral variant is outline-only
   ───────────────────────────────────────────── */
type ChipColor = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'purple';

const CHIP_STYLES: Record<ChipColor, string> = {
  gray: 'border border-line bg-transparent text-fg-2',
  blue: 'bg-accent-soft text-accent-hover dark:text-accent-hover',
  green: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warn-soft text-warn',
  purple: 'bg-accent-soft text-accent-hover',
};

export function Chip({
  color = 'gray',
  children,
  className = '',
}: {
  color?: ChipColor;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${CHIP_STYLES[color]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────
   SegmentedControl — luminance-stepped track
   ───────────────────────────────────────────── */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex rounded-sm border border-line-soft bg-raised p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-xs font-medium transition-colors duration-150 ${
              active
                ? 'bg-surface text-fg shadow-[var(--shadow-raised)] dark:bg-active'
                : 'text-muted hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Page Header ─── */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
    <div className="mb-4 flex items-center gap-3">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-line-soft" />
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
    <nav className="flex items-center gap-1.5 text-xs text-meta">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <IconChevronRight className="h-3 w-3 text-line-strong" />}
          {item.onClick || item.href ? (
            <button
              type="button"
              onClick={item.onClick}
              className="transition-colors hover:text-fg"
            >
              {item.label}
            </button>
          ) : (
            <span className="font-medium text-fg-2">{item.label}</span>
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
      className={`rounded-md border border-line-soft bg-surface ${padding ? 'p-5' : ''} ${className}`}
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
    <div className="flex flex-col items-center rounded-md border border-dashed border-line py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-raised text-muted">
        {icon}
      </div>
      <h4 className="text-[13px] font-semibold text-fg-2">{title}</h4>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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
    <div className="rounded-md border border-line-soft bg-surface p-5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div
        className={`mt-1.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums ${valueClassName ?? 'text-fg'}`}
      >
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-meta">{suffix}</span>}
      </div>
    </div>
  );
}

/* ─── Status Badge ─── */
type BadgeScale = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const BADGE_STYLES: Record<BadgeScale, { bg: string; text: string; dot: string }> = {
  green: { bg: 'bg-success-soft', text: 'text-success', dot: 'bg-success' },
  blue: { bg: 'bg-accent-soft', text: 'text-accent-hover', dot: 'bg-accent-hover' },
  amber: { bg: 'bg-warn-soft', text: 'text-warn', dot: 'bg-warn' },
  red: { bg: 'bg-danger-soft', text: 'text-danger', dot: 'bg-danger' },
  gray: { bg: 'bg-raised', text: 'text-muted', dot: 'bg-meta' },
};

const STATUS_SCALE: Record<string, BadgeScale> = {
  running: 'green',
  thinking: 'blue',
  executing: 'blue',
  starting: 'blue',
  completed: 'green',
  connected: 'green',
  idle: 'amber',
  waiting_input: 'amber',
  error: 'red',
  failed: 'red',
  disconnected: 'red',
  stopped: 'gray',
  pending: 'gray',
  skipped: 'gray',
};

export function StatusBadge({ status, dot = true }: { status: string; dot?: boolean }) {
  const scale = STATUS_SCALE[status] ?? 'gray';
  const s = BADGE_STYLES[scale];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Loading Spinner ─── */
export function LoadingSpinner({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        <span className="text-[13px] text-muted">{text}</span>
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
      className="-ml-2 flex items-center gap-1 rounded-sm px-2 py-1 text-[13px] text-muted transition-colors hover:bg-raised hover:text-fg"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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
  const styles: Record<
    'success' | 'error' | 'info',
    { border: string; bg: string; titleText: string }
  > = {
    success: {
      border: 'border-success/25',
      bg: 'bg-success-soft',
      titleText: 'text-success',
    },
    error: {
      border: 'border-danger/25',
      bg: 'bg-danger-soft',
      titleText: 'text-danger',
    },
    info: {
      border: 'border-accent/25',
      bg: 'bg-accent-soft',
      titleText: 'text-accent-hover',
    },
  };
  const s = styles[type];
  return (
    <div className={`rounded-md border px-4 py-3 ${s.border} ${s.bg}`}>
      {title && <div className={`text-[13px] font-semibold ${s.titleText}`}>{title}</div>}
      <div className={`text-[13px] leading-relaxed text-fg-2 ${title ? 'mt-0.5' : ''}`}>
        {message}
      </div>
    </div>
  );
}
