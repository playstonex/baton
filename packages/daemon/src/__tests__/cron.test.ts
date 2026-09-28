import { describe, it, expect } from 'vitest';
import { parseCron, nextFireDelayMs } from '../scheduler/cron.js';

describe('parseCron', () => {
  it('parses a basic 5-field expression', () => {
    const c = parseCron('0 * * * *');
    expect(c.minute.has(0)).toBe(true);
    expect(c.hour.size).toBe(24); // every hour
  });

  it('parses star as all values', () => {
    const c = parseCron('* * * * *');
    expect(c.minute.size).toBe(60);
    expect(c.hour.size).toBe(24);
    expect(c.dom.size).toBe(31);
    expect(c.month.size).toBe(12);
    // dow * = 0-7, but 7 normalizes to 0 (Sunday), so 7 distinct values.
    expect(c.dow.size).toBe(7);
    expect(c.dow.has(0)).toBe(true);
    expect(c.dow.has(6)).toBe(true);
  });

  it('parses a list', () => {
    const c = parseCron('1,3,5 * * * *');
    expect(c.minute.size).toBe(3);
    expect(c.minute.has(1)).toBe(true);
    expect(c.minute.has(5)).toBe(true);
  });

  it('parses a range', () => {
    const c = parseCron('0 9-17 * * 1-5');
    expect(c.hour.size).toBe(9);
    expect(c.dow.has(1)).toBe(true);
    expect(c.dow.has(5)).toBe(true);
    expect(c.dow.has(6)).toBe(false);
  });

  it('parses a step value', () => {
    const c = parseCron('*/15 * * * *');
    expect(c.minute.size).toBe(4); // 0, 15, 30, 45
    expect(c.minute.has(0)).toBe(true);
    expect(c.minute.has(30)).toBe(true);
  });

  it('normalizes day-of-week 7 to 0 (Sunday)', () => {
    const c = parseCron('* * * * 7');
    expect(c.dow.has(0)).toBe(true);
  });

  it('throws on wrong field count', () => {
    expect(() => parseCron('* * * *')).toThrow('5 fields');
    expect(() => parseCron('* * * * * *')).toThrow('5 fields');
  });

  it('throws on invalid field', () => {
    expect(() => parseCron('abc * * * *')).toThrow();
  });
});

describe('nextFireDelayMs', () => {
  it('returns legacy Nm shorthand as interval', () => {
    expect(nextFireDelayMs('30m')).toBe(30 * 60_000);
  });

  it('returns legacy Nh shorthand as interval', () => {
    expect(nextFireDelayMs('2h')).toBe(2 * 3_600_000);
  });

  it('returns a positive delay for a 5-field cron', () => {
    const delay = nextFireDelayMs('0 9 * * *', new Date('2026-01-01T08:00:00'));
    expect(delay).toBeGreaterThan(0);
    // 8:00 → next 9:00 is 1 hour away
    expect(delay).toBeLessThanOrEqual(3_600_000);
  });

  it('skips forward to next day if time already passed', () => {
    const delay = nextFireDelayMs('0 9 * * *', new Date('2026-01-01T10:00:00'));
    // 10:00 today → 9:00 tomorrow ≈ 23h
    expect(delay).toBeGreaterThan(22 * 3_600_000);
    expect(delay).toBeLessThan(24 * 3_600_000);
  });

  it('fires every minute for star-cron', () => {
    const delay = nextFireDelayMs('* * * * *', new Date('2026-01-01T08:00:30'));
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(60_000);
  });

  it('respects day-of-week filter (weekdays only)', () => {
    // 2026-01-02 is a Friday; 2026-01-03 is Saturday.
    // A 9am weekday cron from Friday 10am should skip to Monday 9am.
    const delay = nextFireDelayMs('0 9 * * 1-5', new Date('2026-01-02T10:00:00'));
    // Friday 10am → Monday 9am ≈ 2d 23h
    expect(delay).toBeGreaterThan(2 * 24 * 3_600_000);
    expect(delay).toBeLessThan(3 * 24 * 3_600_000);
  });
});
