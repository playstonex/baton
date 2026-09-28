/**
 * Cron expression parser supporting standard 5-field syntax plus the legacy
 * Baton shorthand (Nm / Nh).
 *
 * Fields (in order): minute, hour, day-of-month, month, day-of-week (0=Sun or 7=Sun).
 * Each field accepts: star, exact numbers, ranges (1-5), lists (1,3,5), and
 * step values (star-slash-15 or 1-10-slash-2).
 *
 * This computes the next wall-clock fire time after a reference date, so
 * schedules fire at the right moment regardless of when the daemon started.
 */

const FIELD_RANGES: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day-of-month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day-of-week (7 = Sunday)
];

function parseField(field: string, fieldIdx: number): Set<number> {
  const { min, max } = FIELD_RANGES[fieldIdx];
  const result = new Set<number>();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const rangePart = stepMatch ? stepMatch[1] : part;

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = min;
      hi = fieldIdx === 4 ? 7 : max; // dow: * = 0-7
    } else {
      const rangeMatch = rangePart.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        lo = parseInt(rangeMatch[1], 10);
        hi = parseInt(rangeMatch[2], 10);
      } else {
        lo = parseInt(rangePart, 10);
        hi = lo;
      }
    }

    if (Number.isNaN(lo) || Number.isNaN(hi)) {
      throw new Error(`invalid cron field "${field}"`);
    }

    for (let v = lo; v <= hi; v += step) {
      // Normalize dow 7 → 0 (Sunday)
      const norm = fieldIdx === 4 && v === 7 ? 0 : v;
      if (norm >= min && norm <= max) result.add(norm);
    }
  }

  if (result.size === 0) throw new Error(`empty cron field "${field}"`);
  return result;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields, got ${parts.length}: "${expr}"`);
  }
  return {
    minute: parseField(parts[0], 0),
    hour: parseField(parts[1], 1),
    dom: parseField(parts[2], 2),
    month: parseField(parts[3], 3),
    dow: parseField(parts[4], 4),
  };
}

/** Returns the ms delay until the next fire, from `now`. */
export function nextFireDelayMs(expr: string, now: Date = new Date()): number {
  // Legacy shorthand: Nm / Nh (interval syntax).
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 1) {
    if (parts[0].endsWith('m')) return parseInt(parts[0], 10) * 60_000;
    if (parts[0].endsWith('h')) return parseInt(parts[0], 10) * 3_600_000;
  }

  const cron = parseCron(expr);
  const next = nextFireDate(cron, now);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Compute the next Date >= now matching the parsed cron. */
function nextFireDate(cron: ParsedCron, now: Date): Date {
  // Start from one minute after now, zeroing seconds/ms.
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes() + 1,
    0,
    0,
  );

  // Cap iterations to avoid infinite loops on impossible expressions.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dow = d.getDay();
    if (
      cron.minute.has(d.getMinutes()) &&
      cron.hour.has(d.getHours()) &&
      cron.dom.has(d.getDate()) &&
      cron.month.has(d.getMonth() + 1) &&
      cron.dow.has(dow)
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  // Should never happen for valid cron within a year.
  const fallback = new Date(now.getTime() + 3_600_000);
  return fallback;
}
