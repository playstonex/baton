import { Database, type Statement } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ParsedEvent } from '@baton/shared';

interface RequestLog {
  id: number;
  sessionId: string;
  eventType: string;
  tool: string | null;
  success: boolean;
  durationMs: number | null;
  timestamp: number;
  metadata: string | null;
}

interface HourlyStats {
  hour: string;
  totalEvents: number;
  toolCalls: number;
  errors: number;
  avgDurationMs: number | null;
}

interface PendingLog {
  sessionId: string;
  eventType: string;
  tool: string | null;
  success: number;
  durationMs: number | null;
  timestamp: number;
  metadata: string | null;
}

export class AnalyticsService {
  private db: Database;
  private stmtInsert: Statement;
  private writeQueue: PendingLog[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private activeAgents = 0;

  constructor(dbPath?: string) {
    if (dbPath) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath ?? ':memory:', { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.migrate();

    this.stmtInsert = this.db.prepare(
      `INSERT INTO request_logs (session_id, event_type, tool, success, duration_ms, timestamp, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    this.flushTimer = setInterval(() => this.flush(), 2000);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        tool TEXT,
        success INTEGER DEFAULT 1,
        duration_ms INTEGER,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_request_logs_session ON request_logs(session_id)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_request_logs_event_type ON request_logs(event_type)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_request_logs_type_ts ON request_logs(event_type, timestamp)`,
    );
  }

  setActiveAgents(count: number): void {
    this.activeAgents = count;
  }

  logEvent(sessionId: string, event: ParsedEvent): void {
    let tool: string | null = null;
    let success = 1;
    let durationMs: number | null = null;
    let metadata: string | null = null;

    switch (event.type) {
      case 'tool_call_start':
        tool = event.tool;
        metadata = JSON.stringify({ callId: event.callId });
        break;
      case 'tool_call_end':
        success = event.success ? 1 : 0;
        durationMs = event.durationMs ?? null;
        metadata = JSON.stringify({ callId: event.callId });
        break;
      case 'tool_use':
        tool = event.tool;
        metadata = JSON.stringify(event.args);
        break;
      case 'error':
        success = 0;
        metadata = JSON.stringify({ message: event.message });
        break;
      case 'status_change':
        break;
      case 'permission_request':
        tool = event.tool;
        metadata = JSON.stringify({ requestId: event.requestId, action: event.action });
        break;
      case 'permission_response':
        success = event.approved ? 1 : 0;
        metadata = JSON.stringify({ requestId: event.requestId });
        break;
      case 'turn_boundary':
        metadata = JSON.stringify({ turnId: event.turnId, direction: event.direction });
        break;
      default:
        break;
    }

    this.writeQueue.push({
      sessionId,
      eventType: event.type,
      tool,
      success,
      durationMs,
      timestamp: event.timestamp,
      metadata,
    });
  }

  flush(): void {
    if (this.writeQueue.length === 0) return;

    const batch = this.writeQueue.splice(0, this.writeQueue.length);
    const tx = this.db.transaction(() => {
      for (const row of batch) {
        this.stmtInsert.run(
          row.sessionId,
          row.eventType,
          row.tool,
          row.success,
          row.durationMs,
          row.timestamp,
          row.metadata,
        );
      }
    });
    try {
      tx();
    } catch (err) {
      console.error('Analytics flush failed:', err);
    }
  }

  getHealthScore(): {
    score: number;
    successRate: number;
    avgLatencyMs: number;
    activeAgents: number;
    errorCount24h: number;
  } {
    this.flush();

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const row = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
         AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_latency
       FROM request_logs
       WHERE event_type = 'tool_call_end' AND timestamp > ?`,
    ).get(dayAgo) as { total: number; success_count: number; avg_latency: number | null } | null;

    const errors = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE event_type = 'error' AND timestamp > ?`,
    ).get(dayAgo) as { count: number } | null;

    const total = row?.total ?? 0;
    const successes = row?.success_count ?? 0;
    const errorCount = errors?.count ?? 0;
    const successRate = total > 0 ? successes / total : 1;
    const avgLatency = row?.avg_latency ?? 0;

    const errorPenalty = Math.min(errorCount / 10, 1) * 30;
    const latencyPenalty = Math.min(avgLatency / 30000, 1) * 30;
    const successBonus = successRate * 40;
    const score = Math.max(0, Math.min(100, successBonus + (30 - errorPenalty) + (30 - latencyPenalty)));

    return {
      score: Math.round(score * 10) / 10,
      successRate: Math.round(successRate * 1000) / 10,
      avgLatencyMs: Math.round(avgLatency),
      activeAgents: this.activeAgents,
      errorCount24h: errorCount,
    };
  }

  getHourlyStats(hours = 24): HourlyStats[] {
    this.flush();
    const start = Date.now() - hours * 60 * 60 * 1000;

    return this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', timestamp / 1000, 'unixepoch') as hour,
        COUNT(*) as totalEvents,
        SUM(CASE WHEN event_type IN ('tool_use', 'tool_call_start') THEN 1 ELSE 0 END) as toolCalls,
        SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avgDurationMs
      FROM request_logs
      WHERE timestamp > ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(start) as HourlyStats[];
  }

  getSessionStats(sessionId: string): {
    totalEvents: number;
    toolCalls: number;
    errors: number;
    avgToolDurationMs: number;
    topTools: { tool: string; count: number }[];
  } {
    this.flush();

    const row = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN event_type IN ('tool_use', 'tool_call_start') THEN 1 ELSE 0 END) as tools,
         SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors,
         AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_dur
       FROM request_logs WHERE session_id = ?`,
    ).get(sessionId) as { total: number; tools: number; errors: number; avg_dur: number | null };

    const topTools = this.db.prepare(`
      SELECT tool, COUNT(*) as count
      FROM request_logs
      WHERE session_id = ? AND tool IS NOT NULL
      GROUP BY tool
      ORDER BY count DESC
      LIMIT 10
    `).all(sessionId) as { tool: string; count: number }[];

    return {
      totalEvents: row.total,
      toolCalls: row.tools,
      errors: row.errors,
      avgToolDurationMs: Math.round(row.avg_dur ?? 0),
      topTools,
    };
  }

  getRecentEvents(limit = 100): RequestLog[] {
    this.flush();
    return this.db.prepare(
      `SELECT * FROM request_logs ORDER BY timestamp DESC LIMIT ?`,
    ).all(limit) as RequestLog[];
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.db.close();
  }
}
