import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function createIcon(children: React.ReactNode, viewBox = '0 0 16 16') {
  return ({ className, ...props }: IconProps) => (
    <svg
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ─── Navigation ─── */
export const IconDashboard = createIcon(
  <>
    <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
    <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
  </>,
);

export const IconPipelines = createIcon(
  <>
    <circle cx="3" cy="8" r="2" />
    <circle cx="13" cy="8" r="2" />
    <circle cx="8" cy="8" r="2" />
    <path d="M5 8h1M10 8h1" />
  </>,
);

export const IconAnalytics = createIcon(
  <path d="M2 14V7M6 14V4M10 14V9M14 14V2" />,
);

export const IconOrchestration = createIcon(
  <>
    <circle cx="4" cy="4" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="8" cy="12" r="2" />
    <path d="M5.5 5.5L7 10.5M10.5 5.5L9 10.5M6 4h4" />
  </>,
);

export const IconSettings = createIcon(
  <>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </>,
);

export const IconApiProviders = createIcon(
  <>
    <path d="M2 5l6-3 6 3-6 3-6-3z" />
    <path d="M2 8l6 3 6-3" />
    <path d="M2 11l6 3 6-3" />
  </>,
);

/* ─── Theme ─── */
export const IconMoon = createIcon(
  <path d="M14 8.5A5.5 5.5 0 0 1 7.5 2 6 6 0 1 0 14 8.5Z" />,
);

export const IconSun = createIcon(
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
  </>,
);

/* ─── Common Actions ─── */
export const IconChevronLeft = createIcon(
  <path d="M10 12L6 8l4-4" />,
);

export const IconChevronRight = createIcon(
  <path d="M6 4l4 4-4 4" />,
);

export const IconArrowRight = createIcon(
  <path d="M3 8h10M10 5l3 3-3 3" />,
);

export const IconPlus = createIcon(
  <path d="M8 3v10M3 8h10" />,
);

export const IconX = createIcon(
  <path d="M4 4l8 8M12 4l-8 8" />,
);

export const IconMenu = createIcon(
  <>
    <path d="M2 3.5h12" strokeWidth="1.5" />
    <path d="M2 8h12" strokeWidth="1.5" />
    <path d="M2 12.5h12" strokeWidth="1.5" />
  </>,
);

export const IconTerminal = createIcon(
  <>
    <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
    <path d="M4 7h2M4 10h5" />
  </>,
);

export const IconHome = createIcon(
  <path d="M2 8l6-6 6 6M4 6.5V14h3V10h2v4h3V6.5" />,
);

export const IconFile = createIcon(
  <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h4.172a1 1 0 0 1 .707.293l1.328 1.328a1 1 0 0 0 .707.293H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" />,
);

export const IconFolder = createIcon(
  <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.5l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V4.5Z" />,
);

export const IconGitBranch = createIcon(
  <>
    <circle cx="5" cy="3" r="1.5" />
    <circle cx="5" cy="13" r="1.5" />
    <circle cx="12" cy="8" r="1.5" />
    <path d="M5 4.5v7M6.5 11.5L10.5 9.5M6.5 5.5L10.5 7.5" />
  </>,
);

export const IconServer = createIcon(
  <>
    <rect x="2" y="3" width="12" height="8" rx="1" />
    <path d="M5 14h6M8 11v3" />
  </>,
);

export const IconActivity = createIcon(
  <>
    <path d="M1.5 8h2.5l2-5 2 10 2-10 2 5 2.5-2" strokeWidth="1.5" />
  </>,
);

export const IconSearch = createIcon(
  <>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3 3" />
  </>,
);

export const IconCheck = createIcon(
  <path d="M3 8.5l3 3 7-7" />,
);

export const IconAlertCircle = createIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3M8 10.5v.5" />
  </>,
);

export const IconRefreshCw = createIcon(
  <>
    <path d="M14 8a6 6 0 0 1-11.54 2.5" />
    <path d="M14 8H11V5M2 8a6 6 0 0 1 11.54-2.5" />
    <path d="M2 8H5v3" />
  </>,
);

export const IconPlay = createIcon(
  <path d="M4 2.5v11l10-5.5L4 2.5Z" />,
);

export const IconStop = createIcon(
  <rect x="3" y="3" width="10" height="10" rx="1.5" />,
);

export const IconTrash = createIcon(
  <>
    <path d="M2.5 3.5h11M5.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
    <path d="M3.5 3.5l.72 10.08a1 1 0 0 0 1 .92h5.56a1 1 0 0 0 1-.92l.72-10.08" />
  </>,
);

export const IconEdit = createIcon(
  <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5Z" />,
);

export const IconExternalLink = createIcon(
  <>
    <path d="M11 9v3.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7" />
    <path d="M9 2h5v5M8 8l6-6" />
  </>,
);

export const IconMaximize = createIcon(
  <path d="M6 2H3a1 1 0 0 0-1 1v3M10 2h3a1 1 0 0 1 1 1v3M6 14H3a1 1 0 0 1-1-1v-3M10 14h3a1 1 0 0 0 1-1v-3" />,
);

export const IconMinimize = createIcon(
  <path d="M5 11L2 14M2 10v4h4M11 5l3-3M14 6V2h-4" />,
);

export const IconSpinner = ({ className, ...props }: IconProps) => (
  <svg
    className={`animate-spin ${className ?? ''}`}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/* ─── Status Dots ─── */
export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-green-500',
    thinking: 'bg-blue-500',
    executing: 'bg-blue-500',
    idle: 'bg-amber-400',
    waiting_input: 'bg-amber-500',
    stopped: 'bg-gray-400',
    error: 'bg-red-500',
    starting: 'bg-blue-400',
    completed: 'bg-green-500',
    pending: 'bg-gray-300 dark:bg-gray-600',
    failed: 'bg-red-500',
    skipped: 'bg-gray-300 dark:bg-gray-600',
    connected: 'bg-green-500',
    disconnected: 'bg-red-500',
    online: 'bg-green-500',
    offline: 'bg-red-500',
  };
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${colors[status] ?? 'bg-gray-400'} ${status === 'running' || status === 'thinking' || status === 'executing' || status === 'starting' ? 'animate-pulse' : ''}`}
      aria-hidden="true"
    />
  );
}
