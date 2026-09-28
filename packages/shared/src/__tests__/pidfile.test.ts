import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquirePid,
  releasePid,
  readPid,
  isProcessAlive,
  pidfilePath,
  DaemonAlreadyRunningError,
} from '../lifecycle/pidfile.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'baton-pidfile-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function pidfile(): string {
  return pidfilePath(tmpDir);
}

describe('pidfile', () => {
  it('acquire writes the current PID', async () => {
    const pid = await acquirePid(pidfile());
    expect(pid).toBe(process.pid);
    expect(readFileSync(pidfile(), 'utf-8').trim()).toBe(String(process.pid));
  });

  it('readPid returns the written PID', async () => {
    await acquirePid(pidfile());
    expect(await readPid(pidfile())).toBe(process.pid);
  });

  it('readPid returns null when no pidfile', async () => {
    expect(await readPid(pidfile())).toBeNull();
  });

  it('readPid returns null for a corrupt pidfile', async () => {
    writeFileSync(pidfile(), 'not-a-number');
    expect(await readPid(pidfile())).toBeNull();
  });

  it('release removes the pidfile when it belongs to us', async () => {
    await acquirePid(pidfile());
    expect(existsSync(pidfile())).toBe(true);
    await releasePid(pidfile());
    expect(existsSync(pidfile())).toBe(false);
  });

  it('release does not remove a pidfile owned by another PID', async () => {
    writeFileSync(pidfile(), '999999');
    await releasePid(pidfile());
    // Should NOT have removed it — not ours.
    expect(existsSync(pidfile())).toBe(true);
  });

  it('acquire reclaims a stale pidfile (dead process)', async () => {
    // Write a PID that is definitely not running.
    writeFileSync(pidfile(), '999999');
    // isProcessAlive(999999) should be false on most systems.
    expect(isProcessAlive(999999)).toBe(false);
    const pid = await acquirePid(pidfile());
    expect(pid).toBe(process.pid);
  });

  it('acquire refuses when a live process holds the pidfile', async () => {
    // Our own process is definitely alive.
    writeFileSync(pidfile(), String(process.pid));
    await expect(acquirePid(pidfile())).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
  });

  it('isProcessAlive returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
