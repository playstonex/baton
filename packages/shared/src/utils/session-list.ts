import type { AgentStatus, AgentType, StatusDetail } from '../types/index.js';

/**
 * Display logic for session lists (mobile sidebar today, web later): which
 * project a session belongs to, how urgent its status is, and how rows are
 * grouped. Pure functions only, so both clients and tests can share them.
 */

export type SessionBucket = 'needs_input' | 'failed' | 'running' | 'idle' | 'done';

/** Most urgent first: what needs the user comes before what moves on its own. */
export const SESSION_BUCKET_ORDER: readonly SessionBucket[] = [
  'needs_input',
  'failed',
  'running',
  'idle',
  'done',
];

export function deriveSessionBucket(status: AgentStatus): SessionBucket {
  switch (status) {
    case 'waiting_input':
      return 'needs_input';
    case 'error':
      return 'failed';
    case 'starting':
    case 'running':
    case 'thinking':
    case 'executing':
      return 'running';
    case 'idle':
      return 'idle';
    case 'stopped':
      return 'done';
  }
}

/** The more urgent of two buckets. */
export function mostUrgentBucket(buckets: Iterable<SessionBucket>): SessionBucket {
  let best = SESSION_BUCKET_ORDER.length - 1;
  for (const bucket of buckets) {
    const rank = SESSION_BUCKET_ORDER.indexOf(bucket);
    if (rank !== -1 && rank < best) best = rank;
  }
  return SESSION_BUCKET_ORDER[best];
}

/** Collapses SDK variants and legacy aliases onto the agent the user recognises. */
export function canonicalAgentType(type: AgentType | string): string {
  switch (type) {
    case 'claude-code-sdk':
      return 'claude-code';
    case 'codex-sdk':
      return 'codex';
    case 'kiro-cli':
    case 'kiro-cli-acp':
      return 'kiro';
    case 'replay-dev':
      return 'replay';
    default:
      return type;
  }
}

export const UNKNOWN_PROJECT_LABEL = 'Unknown project';

function pathSegments(projectPath?: string | null): string[] {
  if (!projectPath) return [];
  return projectPath.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

/**
 * One display label per distinct project path. The last folder name is used;
 * when two different paths share it, the parent folder is prepended
 * (`work/app` vs `play/app`), growing until labels are unique or paths run out.
 */
export function buildProjectLabels(
  paths: Iterable<string | null | undefined>,
): Map<string, string> {
  const distinct = new Set<string>();
  for (const projectPath of paths) distinct.add(projectPath ?? '');

  const depths = new Map<string, number>();
  for (const projectPath of distinct) depths.set(projectPath, 1);

  const labelOf = (projectPath: string): string => {
    const segments = pathSegments(projectPath);
    if (segments.length === 0) return UNKNOWN_PROJECT_LABEL;
    const depth = Math.min(depths.get(projectPath) ?? 1, segments.length);
    return segments.slice(-depth).join('/');
  };

  for (let round = 0; round < 8; round++) {
    const byLabel = new Map<string, string[]>();
    for (const projectPath of distinct) {
      const label = labelOf(projectPath);
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(projectPath);
      else byLabel.set(label, [projectPath]);
    }
    let widened = false;
    for (const clashing of byLabel.values()) {
      if (clashing.length < 2) continue;
      for (const projectPath of clashing) {
        const segments = pathSegments(projectPath).length;
        const depth = depths.get(projectPath) ?? 1;
        if (depth < segments) {
          depths.set(projectPath, depth + 1);
          widened = true;
        }
      }
    }
    if (!widened) break;
  }

  const labels = new Map<string, string>();
  for (const projectPath of distinct) labels.set(projectPath, labelOf(projectPath));
  return labels;
}

export interface SessionListItem {
  id: string;
  type: AgentType;
  projectPath: string;
  status: AgentStatus;
  title?: string;
  /** Epoch ms of the last activity. */
  lastActivity: number;
  /** Live detail; absent for sessions known only from history. */
  detail?: StatusDetail;
}

export type SessionGroupMode = 'project' | 'status' | 'time';

export const SESSION_GROUP_MODES: readonly SessionGroupMode[] = ['project', 'status', 'time'];

export interface SessionGroup<T extends SessionListItem = SessionListItem> {
  key: string;
  title: string;
  /** Most urgent bucket among the group's rows. */
  bucket: SessionBucket;
  items: T[];
}

export function sessionBucketLabel(bucket: SessionBucket): string {
  switch (bucket) {
    case 'needs_input':
      return 'Needs you';
    case 'failed':
      return 'Error';
    case 'running':
      return 'Working';
    case 'idle':
      return 'Idle';
    case 'done':
      return 'Stopped';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function timeGroupOf(age: number): { key: string; title: string; rank: number } {
  if (age < DAY_MS) return { key: 'today', title: 'Today', rank: 0 };
  if (age < 2 * DAY_MS) return { key: 'yesterday', title: 'Yesterday', rank: 1 };
  if (age < 7 * DAY_MS) return { key: 'week', title: 'Previous 7 Days', rank: 2 };
  return { key: 'older', title: 'Older', rank: 3 };
}

function byRecency(a: SessionListItem, b: SessionListItem): number {
  return b.lastActivity - a.lastActivity;
}

/** Urgent rows first, then newest first. */
function byUrgencyThenRecency(a: SessionListItem, b: SessionListItem): number {
  const rankA = SESSION_BUCKET_ORDER.indexOf(deriveSessionBucket(a.status));
  const rankB = SESSION_BUCKET_ORDER.indexOf(deriveSessionBucket(b.status));
  return rankA - rankB || byRecency(a, b);
}

export function groupSessions<T extends SessionListItem>(
  items: readonly T[],
  mode: SessionGroupMode,
  options: { projectLabels: ReadonlyMap<string, string>; now?: number },
): SessionGroup<T>[] {
  const now = options.now ?? Date.now();
  const buckets = new Map<string, { title: string; rank: number; items: T[] }>();

  const add = (key: string, title: string, rank: number, item: T) => {
    const existing = buckets.get(key);
    if (existing) existing.items.push(item);
    else buckets.set(key, { title, rank, items: [item] });
  };

  for (const item of items) {
    if (mode === 'project') {
      const title = options.projectLabels.get(item.projectPath) ?? UNKNOWN_PROJECT_LABEL;
      add(`project:${item.projectPath}`, title, 0, item);
    } else if (mode === 'status') {
      const bucket = deriveSessionBucket(item.status);
      add(
        `status:${bucket}`,
        sessionBucketLabel(bucket),
        SESSION_BUCKET_ORDER.indexOf(bucket),
        item,
      );
    } else {
      const group = timeGroupOf(now - item.lastActivity);
      add(`time:${group.key}`, group.title, group.rank, item);
    }
  }

  const groups: SessionGroup<T>[] = [];
  for (const [key, bucket] of buckets) {
    const rows = [...bucket.items].sort(mode === 'project' ? byUrgencyThenRecency : byRecency);
    groups.push({
      key,
      title: bucket.title,
      bucket: mostUrgentBucket(rows.map((row) => deriveSessionBucket(row.status))),
      items: rows,
    });
  }

  if (mode === 'project') {
    groups.sort((a, b) => {
      const urgency =
        SESSION_BUCKET_ORDER.indexOf(a.bucket) - SESSION_BUCKET_ORDER.indexOf(b.bucket);
      const urgent = (group: SessionGroup<T>) =>
        group.bucket === 'needs_input' || group.bucket === 'failed';
      if (urgent(a) !== urgent(b)) return urgent(a) ? -1 : 1;
      if (urgent(a) && urgency !== 0) return urgency;
      return b.items[0].lastActivity - a.items[0].lastActivity;
    });
  } else {
    const rankOf = (group: SessionGroup<T>) => buckets.get(group.key)?.rank ?? 0;
    groups.sort((a, b) => rankOf(a) - rankOf(b));
  }
  return groups;
}

function collapse(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The status line shown under a row's title. */
export function describeSessionStatus(item: SessionListItem, maxLength = 48): string {
  const detail = item.detail;
  switch (item.status) {
    case 'waiting_input':
      return detail?.prompt ? collapse(detail.prompt, maxLength) : 'Waiting for you';
    case 'error':
      return detail?.error ? collapse(detail.error, maxLength) : 'Error';
    case 'executing': {
      const tool = detail?.toolTitle ?? detail?.tool;
      return tool ? collapse(tool, maxLength) : 'Working';
    }
    case 'starting':
      return 'Starting';
    case 'thinking':
      return 'Thinking';
    case 'running':
      return 'Working';
    case 'idle':
      return 'Idle';
    case 'stopped':
      return 'Stopped';
  }
}

/** Case-insensitive match against title, project path/label and agent type. */
export function sessionMatchesQuery(
  item: SessionListItem,
  query: string,
  projectLabel: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    item.title ?? '',
    item.projectPath,
    projectLabel,
    item.type,
    canonicalAgentType(item.type),
  ]
    .join('\n')
    .toLowerCase()
    .includes(needle);
}
