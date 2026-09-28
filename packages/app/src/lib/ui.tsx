import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { IconChevronRight, StatusDot } from './icons.js';
export { StatusDot };

/* ─────────────────────────────────────────────
   Button — Geist component tokens
   primary: gray-1000 fill / background-100 label
   secondary: background-100 fill / gray-alpha-400 border
   tertiary: transparent / gray-1000 text
   error: red-800 fill / white label
   Sizes: sm 32px / md 40px / lg 48px
   ───────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'error';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap rounded-[var(--radius-sm)] transition-colors focus-visible:focus-ring disabled:cursor-not-allowed select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-geist-gray-1000 text-geist-background-100 hover:bg-geist-gray-900 disabled:bg-geist-gray-100 disabled:text-geist-gray-700',
  secondary:
    'bg-geist-background-100 text-geist-gray-1000 border border-geist-gray-alpha-400 hover:bg-geist-gray-alpha-100 disabled:text-geist-gray-700',
  tertiary:
    'bg-transparent text-geist-gray-1000 hover:bg-geist-gray-alpha-200 disabled:text-geist-gray-700',
  error:
    'bg-geist-red-800 text-white hover:bg-geist-red-900 disabled:bg-geist-gray-100 disabled:text-geist-gray-700',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3.5 text-sm',
  lg: 'h-12 px-4 text-base',
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
   Input — Geist component tokens
   background-100 fill / gray-alpha-400 border / radius-sm
   Sizes: sm 32px / md 40px / lg 48px
   ───────────────────────────────────────────── */
type InputSize = 'sm' | 'md' | 'lg';

const INPUT_SIZES: Record<InputSize, string> = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-12 text-base',
};

export function Input({
  size = 'md',
  className = '',
  ...props
}: { size?: InputSize } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return (
    <input
      className={`w-full rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 px-3 text-geist-gray-1000 placeholder:text-geist-gray-700 transition-colors focus:border-geist-blue-700 focus-visible:focus-ring focus:outline-none disabled:opacity-50 ${INPUT_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/* ─────────────────────────────────────────────
   ProgressBar — Geist track + accent fill
   ───────────────────────────────────────────── */
type ProgressColor = 'blue' | 'green' | 'amber' | 'red';

const PROGRESS_FILLS: Record<ProgressColor, string> = {
  blue: 'bg-geist-blue-700',
  green: 'bg-geist-green-700',
  amber: 'bg-geist-amber-600',
  red: 'bg-geist-red-700',
};

export function ProgressBar({
  value,
  color = 'blue',
  className = '',
  ...props
}: { value: number; color?: ProgressColor } & React.HTMLAttributes<HTMLDivElement>) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-geist-gray-alpha-200 ${className}`}
      {...props}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${PROGRESS_FILLS[color]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Chip — soft variant ({color}-100 bg, {color}-700 text)
   ───────────────────────────────────────────── */
type ChipColor = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'purple';

const CHIP_STYLES: Record<ChipColor, string> = {
  gray: 'bg-geist-gray-alpha-200 text-geist-gray-1000',
  blue: 'bg-geist-blue-100 text-geist-blue-700 dark:bg-geist-blue-1000 dark:text-geist-blue-900',
  green: 'bg-geist-green-100 text-geist-green-700 dark:bg-geist-green-1000 dark:text-geist-green-900',
  red: 'bg-geist-red-100 text-geist-red-700 dark:bg-geist-red-1000 dark:text-geist-red-900',
  amber: 'bg-geist-amber-100 text-geist-amber-900 dark:bg-geist-amber-1000 dark:text-geist-amber-600',
  purple: 'bg-geist-purple-100 text-geist-purple-700 dark:bg-geist-purple-1000 dark:text-geist-purple-900',
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_STYLES[color]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────
   SegmentedControl — replaces UpstreamFormatSelector
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
      className={`inline-flex rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-gray-alpha-100 p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-geist-background-100 text-geist-gray-1000 shadow-[var(--shadow-raised)]'
                : 'text-geist-gray-800 hover:text-geist-gray-1000'
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
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-geist-gray-1000">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-geist-gray-800">{description}</p>}
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
      <h3 className="text-sm font-semibold text-geist-gray-1000">{title}</h3>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center rounded-full bg-geist-gray-alpha-200 px-2 py-0.5 text-xs font-medium tabular-nums text-geist-gray-900">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-geist-gray-alpha-200" />
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
    <nav className="flex items-center gap-1.5 text-xs text-geist-gray-700">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <IconChevronRight className="h-3 w-3 text-geist-gray-alpha-600" />}
          {item.onClick || item.href ? (
            <button
              type="button"
              onClick={item.onClick}
              className="transition-colors hover:text-geist-blue-700"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-geist-gray-900">{item.label}</span>
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
      className={`rounded-[var(--radius-md)] border border-geist-gray-alpha-400 bg-geist-background-100 shadow-[var(--shadow-raised)] ${
        padding ? 'p-6' : ''
      } ${className}`}
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
    <div className="flex flex-col items-center rounded-[var(--radius-md)] border border-dashed border-geist-gray-alpha-500 bg-geist-gray-alpha-100 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] bg-geist-gray-alpha-200">
        {icon}
      </div>
      <h4 className="text-sm font-semibold text-geist-gray-900">{title}</h4>
      {description && <p className="mt-1 text-xs text-geist-gray-800">{description}</p>}
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
    <div className="rounded-[var(--radius-md)] border border-geist-gray-alpha-400 bg-geist-background-100 p-6 shadow-[var(--shadow-raised)]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-geist-gray-800">
        {label}
      </div>
      <div
        className={`mt-1.5 text-2xl font-bold tabular-nums ${valueClassName ?? 'text-geist-gray-1000'}`}
      >
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-geist-gray-800">{suffix}</span>}
      </div>
    </div>
  );
}

/* ─── Status Badge ─── */
type BadgeScale = 'green' | 'blue' | 'amber' | 'red' | 'gray';

const BADGE_STYLES: Record<BadgeScale, { bg: string; text: string; dot: string }> = {
  green: {
    bg: 'bg-geist-green-100 dark:bg-geist-green-1000',
    text: 'text-geist-green-700 dark:text-geist-green-900',
    dot: 'bg-geist-green-600',
  },
  blue: {
    bg: 'bg-geist-blue-100 dark:bg-geist-blue-1000',
    text: 'text-geist-blue-700 dark:text-geist-blue-900',
    dot: 'bg-geist-blue-600',
  },
  amber: {
    bg: 'bg-geist-amber-100 dark:bg-geist-amber-1000',
    text: 'text-geist-amber-900 dark:text-geist-amber-600',
    dot: 'bg-geist-amber-600',
  },
  red: {
    bg: 'bg-geist-red-100 dark:bg-geist-red-1000',
    text: 'text-geist-red-700 dark:text-geist-red-900',
    dot: 'bg-geist-red-600',
  },
  gray: {
    bg: 'bg-geist-gray-alpha-200',
    text: 'text-geist-gray-900',
    dot: 'bg-geist-gray-500',
  },
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

export function StatusBadge({
  status,
  dot = true,
}: {
  status: string;
  dot?: boolean;
}) {
  const scale = STATUS_SCALE[status] ?? 'gray';
  const s = BADGE_STYLES[scale];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
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
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-geist-blue-700 border-t-transparent" />
        <span className="text-sm text-geist-gray-800">{text}</span>
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
      className="-ml-2 flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-geist-gray-800 transition-colors hover:bg-geist-gray-alpha-200 hover:text-geist-gray-1000"
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
    { border: string; bg: string; titleText: string; msgText: string }
  > = {
    success: {
      border: 'border-geist-green-100 dark:border-geist-green-1000',
      bg: 'bg-geist-green-100 dark:bg-geist-green-1000',
      titleText: 'text-geist-green-700 dark:text-geist-green-900',
      msgText: 'text-geist-green-900 dark:text-geist-green-900',
    },
    error: {
      border: 'border-geist-red-100 dark:border-geist-red-1000',
      bg: 'bg-geist-red-100 dark:bg-geist-red-1000',
      titleText: 'text-geist-red-700 dark:text-geist-red-900',
      msgText: 'text-geist-red-900 dark:text-geist-red-900',
    },
    info: {
      border: 'border-geist-blue-100 dark:border-geist-blue-1000',
      bg: 'bg-geist-blue-100 dark:bg-geist-blue-1000',
      titleText: 'text-geist-blue-700 dark:text-geist-blue-900',
      msgText: 'text-geist-blue-1000 dark:text-geist-blue-900',
    },
  };
  const s = styles[type];
  return (
    <div className={`rounded-[var(--radius-sm)] border px-4 py-3 ${s.border} ${s.bg}`}>
      {title && <div className={`text-sm font-medium ${s.titleText}`}>{title}</div>}
      <div className={`mt-0.5 text-sm ${s.msgText}`}>{message}</div>
    </div>
  );
}
