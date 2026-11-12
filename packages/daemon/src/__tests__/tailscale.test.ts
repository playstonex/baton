import { describe, it, expect } from 'bun:test';
import { isTailscaleIpv4Address, getTailscaleStatus } from '../system/tailscale.js';

describe('Tailscale Service (T3 Code Direct Connect)', () => {
  it('correctly validates Tailscale IPv4 addresses (100.64.0.0/10)', () => {
    // Valid CGNAT addresses within 100.64.0.0 - 100.127.255.255
    expect(isTailscaleIpv4Address('100.64.0.1')).toBe(true);
    expect(isTailscaleIpv4Address('100.85.120.45')).toBe(true);
    expect(isTailscaleIpv4Address('100.127.255.254')).toBe(true);

    // Out of range or invalid
    expect(isTailscaleIpv4Address('100.63.255.255')).toBe(false);
    expect(isTailscaleIpv4Address('100.128.0.1')).toBe(false);
    expect(isTailscaleIpv4Address('192.168.1.1')).toBe(false);
    expect(isTailscaleIpv4Address('10.0.0.1')).toBe(false);
    expect(isTailscaleIpv4Address('invalid-ip')).toBe(false);
    expect(isTailscaleIpv4Address('100.64.1')).toBe(false);
  });

  it('queries Tailscale status gracefully without throwing', async () => {
    const report = await getTailscaleStatus();
    expect(report).toBeDefined();
    expect(typeof report.available).toBe('boolean');
    expect(typeof report.online).toBe('boolean');
    expect(Array.isArray(report.tailscaleIps)).toBe(true);
  });
});
