import { Database, type Statement } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentStatus, AgentType, ParsedEvent, SessionSummary } from '@baton/shared';

/**
 * Persistent session transcripts + metadata (`$BATON_HOME/sessions.db`).
 *
 * Design borrowed from the paseo/happy reference projects:
 * - The daemon owns the single durable copy of every session's metadata and
 *   event/output history; clients are dumb consumers that re-fetch.
 * - Attach replays a bounded TAIL; deep history stays queryable here.
 * - Sessions soft-delete via `archived_at` and are hard-pruned by age/count.
 *
 * Before this store existed, only AgentSnapshot JSON metadata was persisted —
 * a daemon restart emptied every transcript and fed clients a type-mangled
 * TimelineItem[] cast to ParsedEvent[].
 */

/** Raw row shape as returned by SQLite (column names are snake_case). */
export interface SessionRecord {
  id: string;
  type: string;
  project_path: string;
  mode: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  stopped_at: string | null;
  archived_at: string | null;
  exit_code: number | null;
  pid: number | null;
}

export interface SessionUpsert {
  id: string;
  type: AgentType;
  projectPath: string;
  mode: 'pty' | 'sdk';
  status: AgentStatus;
  createdAt: string;
}

export interface SessionPatch {
  status?: AgentStatus;
  title?: string;
  stoppedAt?: string | null;
  archivedAt?: string | null;
  exitCode?: number;
  pid?: number | null;
  /** Last-activity timestamp; callers throttle this. */
  updatedAt?: string;
}

export interface SessionQuery {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  projectPath?: string;
  /** Filter to a single id (used to cheaply check existence). */
  id?: string;
}

export interface SessionQueryResult {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
}

/** Cap on any single stored text payload — same bound paseo uses for tool
 * output. A pathological PTY chunk must not bloat the DB row. */
const MAX_TEXT_BYTES = 64 * 1024;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/** Hard transcript retention: sessions unused for 90 days are deleted. */
const PRUNE_MAX_AGE_DAYS = 90;
/** Or when more than this many non-archived sessions exist, oldest go first. */
const PRUNE_MAX_COUNT = 1000;

export class SessionStore {
  private db: Database;
  private stmtUpsert: Statement;
  private stmtPatch: Statement;
  private stmtGet: Statement;
  private stmtDelete: Statement;
  private stmtSetArchived: Statement;
  private stmtCount: Statement;
  private stmtAppendEvent: Statement;
  private stmtAppendOutput: Statement;
  private stmtEventTail: Statement;
  private stmtOutputTail: Statement;
  private stmtEventCount: Statement;
  private stmtDeleteEvents: Statement;
  private stmtDeleteOutput: Statement;
  /** Last assigned seq per session, cached to avoid MAX(seq) on hot paths. */
  private seqCache = new Map<string, number>();

  constructor(dbPath?: string) {
    if (dbPath) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath ?? ':memory:', { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.migrate();

    this.stmtUpsert = this.db.prepare(
      `INSERT INTO sessions (id, type, project_path, mode, title, status, created_at, updated_at, stopped_at, archived_at, exit_code, pid)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    );
    this.stmtPatch = this.db.prepare(
      `UPDATE sessions SET
         status = COALESCE(?, status),
         title = COALESCE(?, title),
         stopped_at = COALESCE(?, stopped_at),
         archived_at = COALESCE(?, archived_at),
         exit_code = COALESCE(?, exit_code),
         pid = COALESCE(?, pid),
         updated_at = COALESCE(?, updated_at)
       WHERE id = ?`,
    );
    this.stmtGet = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.stmtDelete = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    // patchSession's COALESCE can never clear a column back to NULL, so
    // archived_at gets a dedicated statement (archive AND unarchive).
    this.stmtSetArchived = this.db.prepare('UPDATE sessions SET archived_at = ? WHERE id = ?');
    this.stmtCount = this.db.prepare('SELECT COUNT(*) AS n FROM sessions');
    this.stmtAppendEvent = this.db.prepare(
      `INSERT INTO events (session_id, seq, ts, event) VALUES (?, ?, ?, ?)`,
    );
    this.stmtAppendOutput = this.db.prepare(
      `INSERT INTO output (session_id, seq, chunk) VALUES (?, ?, ?)`,
    );
    this.stmtEventTail = this.db.prepare(
      `SELECT event FROM (SELECT seq, event FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC`,
    );
    this.stmtOutputTail = this.db.prepare(
      `SELECT chunk FROM (SELECT seq, chunk FROM output WHERE session_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC`,
    );
    this.stmtEventCount = this.db.prepare(
      'SELECT COUNT(*) AS n FROM events WHERE session_id = ?',
    );
    this.stmtDeleteEvents = this.db.prepare('DELETE FROM events WHERE session_id = ?');
    this.stmtDeleteOutput = this.db.prepare('DELETE FROM output WHERE session_id = ?');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project_path TEXT NOT NULL,
        mode TEXT,
        title TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stopped_at TEXT,
        archived_at TEXT,
        exit_code INTEGER,
        pid INTEGER
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)`,
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS output (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      )
    `);
  }

  // ── Metadata ─────────────────────────────────────────────────────

  upsertSession(info: SessionUpsert, pid?: number): void {
    this.stmtUpsert.run(
      info.id,
      info.type,
      info.projectPath,
      info.mode,
      info.status,
      info.createdAt,
      info.createdAt,
      pid ?? null,
    );
  }

  patchSession(id: string, patch: SessionPatch): void {
    this.stmtPatch.run(
      patch.status ?? null,
      patch.title ?? null,
      patch.stoppedAt ?? null,
      patch.archivedAt ?? null,
      patch.exitCode ?? null,
      patch.pid ?? null,
      patch.updatedAt ?? null,
      id,
    );
  }

  getSession(id: string): SessionRecord | null {
    const row = this.stmtGet.get(id) as unknown as SessionRecord | null;
    return row ?? null;
  }

  /** Set or clear the archive marker. `null` unarchives. */
  setArchived(id: string, at: string | null): void {
    this.stmtSetArchived.run(at, id);
  }

  /**
   * Crash recovery at boot: anything mid-flight when the daemon died is dead
   * now — force it to `stopped` with a non-zero exit code (the old snapshot
   * restore did the same).
   */
  markNonTerminalStopped(): number {
    return this.db
      .prepare(
        `UPDATE sessions SET status = 'stopped', stopped_at = updated_at, exit_code = -1
         WHERE status NOT IN ('stopped', 'error')`,
      )
      .run().changes;
  }

  deleteSession(id: string): void {
    this.stmtDeleteEvents.run(id);
    this.stmtDeleteOutput.run(id);
    this.stmtDelete.run(id);
    this.seqCache.delete(id);
  }

  countSessions(): number {
    return (this.stmtCount.get() as { n: number }).n;
  }

  /** Sessions whose metadata matches — used by the legacy-snapshot import
   * to keep re-imports idempotent after a crash between import and cleanup. */
  hasSession(id: string): boolean {
    return this.getSession(id) !== null;
  }

  // ── Transcript ───────────────────────────────────────────────────

  private nextSeq(sessionId: string): number {
    const cached = this.seqCache.get(sessionId);
    if (cached !== undefined) {
      const next = cached + 1;
      this.seqCache.set(sessionId, next);
      return next;
    }
    const row = this.db
      .query(
        `SELECT MAX(seq) AS m FROM (
           SELECT MAX(seq) AS seq FROM events WHERE session_id = ?
           UNION ALL
           SELECT MAX(seq) AS seq FROM output WHERE session_id = ?
         )`,
      )
      .get(sessionId, sessionId) as { m: number | null };
    const next = (row.m ?? 0) + 1;
    this.seqCache.set(sessionId, next);
    return next;
  }

  appendEvent(sessionId: string, event: ParsedEvent): void {
    const json = JSON.stringify(capEvent(event));
    this.stmtAppendEvent.run(sessionId, this.nextSeq(sessionId), event.timestamp, json);
  }

  appendOutput(sessionId: string, chunk: string): void {
    this.stmtAppendOutput.run(sessionId, this.nextSeq(sessionId), capText(chunk));
  }

  /** Newest-last tail of the event history (bounded — attach replay size). */
  getEventTail(sessionId: string, limit: number): ParsedEvent[] {
    const rows = this.stmtEventTail.all(sessionId, limit) as { event: string }[];
    const out: ParsedEvent[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.event) as ParsedEvent);
      } catch {
        // skip corrupt row rather than failing the whole replay
      }
    }
    return out;
  }

  /** Newest-last tail of display output chunks. */
  getOutputTail(sessionId: string, limit: number): string[] {
    const rows = this.stmtOutputTail.all(sessionId, limit) as { chunk: string }[];
    return rows.map((r) => r.chunk);
  }

  getEventCount(sessionId: string): number {
    return (this.stmtEventCount.get(sessionId) as { n: number }).n;
  }

  // ── Listing ──────────────────────────────────────────────────────

  list(query: SessionQuery = {}): SessionQueryResult {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.archivedOnly) {
      conditions.push('s.archived_at IS NOT NULL');
    } else if (!query.includeArchived) {
      conditions.push('s.archived_at IS NULL');
    }
    if (query.projectPath) {
      conditions.push('s.project_path = ?');
      params.push(query.projectPath);
    }
    if (query.id) {
      conditions.push('s.id = ?');
      params.push(query.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM sessions s ${where}`).get(...params) as {
        n: number;
      }
    ).n;

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count
         FROM sessions s ${where}
         ORDER BY s.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<SessionRecord & { event_count: number }>;

    const sessions = rows.map(toSummary);
    return { sessions, total, hasMore: offset + sessions.length < total };
  }

  // ── Maintenance ──────────────────────────────────────────────────

  /** Delete sessions past the retention window. Returns pruned ids. */
  prune(): string[] {
    const cutoff = new Date(Date.now() - PRUNE_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const stale = this.db
      .prepare(`SELECT id FROM sessions WHERE updated_at < ?`)
      .all(cutoff) as { id: string }[];
    const pruned = new Set(stale.map((r) => r.id));

    // Count-based cap on live (non-archived) sessions: keep the newest N.
    const overflow = this.db
      .prepare(
        `SELECT id FROM sessions WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT -1 OFFSET ?`,
      )
      .all(PRUNE_MAX_COUNT) as { id: string }[];
    for (const row of overflow) pruned.add(row.id);

    for (const id of pruned) this.deleteSession(id);
    return [...pruned];
  }

  close(): void {
    this.db.close();
  }
}

function toSummary(row: SessionRecord & { event_count: number }): SessionSummary {
  return {
    id: row.id,
    type: row.type as AgentType,
    projectPath: row.project_path,
    status: row.status as AgentStatus,
    mode: (row.mode as 'pty' | 'sdk' | null) ?? undefined,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stoppedAt: row.stopped_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    eventCount: row.event_count,
  };
}

function capText(text: string): string {
  if (text.length <= MAX_TEXT_BYTES) return text;
  return `${text.slice(0, MAX_TEXT_BYTES)}\n…[truncated ${text.length - MAX_TEXT_BYTES} chars]`;
}

/** Bound the biggest known text fields before persisting an event. */
function capEvent(event: ParsedEvent): ParsedEvent {
  const e = event as unknown as Record<string, unknown>;
  for (const key of ['content', 'diff', 'output']) {
    if (typeof e[key] === 'string' && (e[key] as string).length > MAX_TEXT_BYTES) {
      e[key] = capText(e[key] as string);
    }
  }
  if (e.args && typeof e.args === 'object') {
    for (const [k, v] of Object.entries(e.args as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > MAX_TEXT_BYTES) {
        (e.args as Record<string, unknown>)[k] = capText(v);
      }
    }
  }
  return event;
}

/**
 * Provisional session title from the first user prompt — paseo's approach:
 * first non-empty line, whitespace-normalized, clamped. No LLM call.
 */
export function deriveTitle(prompt: string): string {
  const firstLine =
    prompt
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? 'New session';
  const normalized = firstLine.replace(/\s+/g, ' ');
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized;
}
