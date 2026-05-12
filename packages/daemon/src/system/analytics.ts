import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
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

export class AnalyticsService {
  private db: Database;

  constructor(dbPath?: string) {
    if (dbPath) {
      const dir = dirname(dbPath);
      mkdir(dir, { recursive: true }).catch(() => {});
    }
    this.db = new Database(dbPath ?? ':memory:', { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.migrate();
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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_request_logs_session ON request_logs(session_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_request_logs_event_type ON request_logs(event_type)
    `);
  }

  logEvent(sessionId: string, event: ParsedEvent): void {
    const insert = this.db.prepare(`
      INSERT INTO request_logs (session_id, event_type, tool, success, duration_ms, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    switch (event.type) {
      case 'tool_call_start':
        insert.run(sessionId, 'tool_call_start', event.tool, 1, null, event.timestamp, JSON.stringify({ callId: event.callId }));
        break;
      case 'tool_call_end':
        insert.run(sessionId, 'tool_call_end', null, event.success ? 1 : 0, event.durationMs ?? null, event.timestamp, JSON.stringify({ callId: event.callId }));
        break;
      case 'tool_use':
        insert.run(sessionId, 'tool_use', event.tool, 1, null, event.timestamp, JSON.stringify(event.args));
        break;
      case 'error':
        insert.run(sessionId, 'error', null, 0, null, event.timestamp, JSON.stringify({ message: event.message }));
        break;
      case 'status_change':
        insert.run(sessionId, 'status_change', null, 1, null, event.timestamp, null);
        break;
      case 'permission_request':
        insert.run(sessionId, 'permission_request', event.tool, 1, null, event.timestamp, JSON.stringify({ requestId: event.requestId, action: event.action }));
        break;
      case 'permission_response':
        insert.run(sessionId, 'permission_response', null, event.approved ? 1 : 0, null, event.timestamp, JSON.stringify({ requestId: event.requestId }));
        break;
      case 'turn_boundary':
        insert.run(sessionId, 'turn_boundary', null, 1, null, event.timestamp, JSON.stringify({ turnId: event.turnId, direction: event.direction }));
        break;
      default:
        insert.run(sessionId, event.type, null, 1, null, event.timestamp, null);
    }
  }

  getHealthScore(): {
    score: number;
    successRate: number;
    avgLatencyMs: number;
    activeAgents: number;
    errorCount24h: number;
  } {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const totalCalls = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE event_type = 'tool_call_end' AND timestamp > ?`
    ).get(dayAgo) as { count: number } | null;

    const successCalls = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE event_type = 'tool_call_end' AND success = 1 AND timestamp > ?`
    ).get(dayAgo) as { count: number } | null;

    const errorCount = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE event_type = 'error' AND timestamp > ?`
    ).get(dayAgo) as { count: number } | null;

    const avgDuration = this.db.prepare(
      `SELECT AVG(duration_ms) as avg FROM request_logs WHERE event_type = 'tool_call_end' AND duration_ms IS NOT NULL AND timestamp > ?`
    ).get(dayAgo) as { avg: number | null } | null;

    const total = totalCalls?.count ?? 0;
    const successes = successCalls?.count ?? 0;
    const errors = errorCount?.count ?? 0;
    const successRate = total > 0 ? successes / total : 1;
    const avgLatency = avgDuration?.avg ?? 0;

    // Health score: weighted combination
    const errorPenalty = Math.min(errors / 10, 1) * 30;
    const latencyPenalty = Math.min(avgLatency / 30000, 1) * 30;
    const successBonus = successRate * 40;
    const score = Math.max(0, Math.min(100, successBonus + (30 - errorPenalty) + (30 - latencyPenalty)));

    return {
      score: Math.round(score * 10) / 10,
      successRate: Math.round(successRate * 1000) / 10,
      avgLatencyMs: Math.round(avgLatency),
      activeAgents: 0,
      errorCount24h: errors,
    };
  }

  getHourlyStats(hours = 24): HourlyStats[] {
    const now = Date.now();
    const start = now - hours * 60 * 60 * 1000;

    const rows = this.db.prepare(`
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

    return rows;
  }

  getSessionStats(sessionId: string): {
    totalEvents: number;
    toolCalls: number;
    errors: number;
    avgToolDurationMs: number;
    topTools: { tool: string; count: number }[];
  } {
    const total = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE session_id = ?`
    ).get(sessionId) as { count: number };

    const tools = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE session_id = ? AND event_type IN ('tool_use', 'tool_call_start')`
    ).get(sessionId) as { count: number };

    const errors = this.db.prepare(
      `SELECT COUNT(*) as count FROM request_logs WHERE session_id = ? AND event_type = 'error'`
    ).get(sessionId) as { count: number };

    const avgDur = this.db.prepare(
      `SELECT AVG(duration_ms) as avg FROM request_logs WHERE session_id = ? AND duration_ms IS NOT NULL`
    ).get(sessionId) as { avg: number | null };

    const topTools = this.db.prepare(`
      SELECT tool, COUNT(*) as count
      FROM request_logs
      WHERE session_id = ? AND tool IS NOT NULL
      GROUP BY tool
      ORDER BY count DESC
      LIMIT 10
    `).all(sessionId) as { tool: string; count: number }[];

    return {
      totalEvents: total.count,
      toolCalls: tools.count,
      errors: errors.count,
      avgToolDurationMs: Math.round(avgDur.avg ?? 0),
      topTools,
    };
  }

  getRecentEvents(limit = 100): RequestLog[] {
    return this.db.prepare(`
      SELECT * FROM request_logs ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as RequestLog[];
  }

  close(): void {
    this.db.close();
  }
}
