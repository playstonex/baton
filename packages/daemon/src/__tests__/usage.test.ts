import { describe, it, expect } from 'bun:test';
import { getModelUsage } from '../system/usage.js';

describe('Model Usage Monitoring', () => {
  it('returns a structured ModelUsageReport', async () => {
    const report = await getModelUsage();
    expect(report).toBeDefined();
    expect(typeof report.available).toBe('boolean');
    expect(report.provider).toBe('claude');
    expect(typeof report.updatedAt).toBe('number');

    if (report.available) {
      if (report.fiveHour) {
        expect(typeof report.fiveHour.utilization).toBe('number');
      }
      if (report.sevenDay) {
        expect(typeof report.sevenDay.utilization).toBe('number');
      }
    } else {
      expect(typeof report.reason).toBe('string');
    }
  });
});
