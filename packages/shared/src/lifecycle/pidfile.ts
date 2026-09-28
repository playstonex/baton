/**
 * PID file management for the daemon's own process lifecycle.
 *
 * The daemon writes its PID to `$BATON_HOME/daemon.pid` on start so that the
 * CLI (`baton daemon stop/status/restart`) and future desktop companions can
 * locate and control it without shell-outs to npm. This makes the CLI the
 * single machine-readable control plane for daemon lifecycle.
 *
 * - `acquire()` refuses to start if a live daemon is already running (stale
 *   pidfiles from crashed processes are detected and reclaimed).
 * - `release()` removes the pidfile on graceful exit.
 */

import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function pidfilePath(batonHome: string): string {
  return join(batonHome, 'daemon.pid');
}

function batonHome(): string {
  return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
}

/** PID file is at $BATON_HOME/daemon.pid */
export function defaultPidfile(): string {
  return pidfilePath(batonHome());
}

/**
 * Check whether a process is alive. Cross-platform: uses process.kill(pid, 0)
 * which sends signal 0 (existence check) without actually signalling.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; anything else (EPERM) means it's alive but
    // we can't signal it — treat as alive.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Read the PID from the pidfile, or null if absent/invalid. */
export async function readPid(path: string = defaultPidfile()): Promise<number | null> {
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Write the current process's PID to the pidfile. If a live daemon is already
 * running (pidfile present AND that PID is alive), throws so the caller can
 * refuse the duplicate start. A stale pidfile (process dead) is reclaimed.
 *
 * @returns the PID that was written.
 */
export async function acquirePid(path: string = defaultPidfile()): Promise<number> {
  const existing = await readPid(path);
  if (existing !== null && isProcessAlive(existing)) {
    throw new DaemonAlreadyRunningError(existing, path);
  }

  const dir = path.slice(0, Math.max(0, path.lastIndexOf('/')));
  if (dir && !existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const pid = process.pid;
  await writeFile(path, String(pid), { mode: 0o644 });
  return pid;
}

/** Remove the pidfile if it belongs to the current process. */
export async function releasePid(path: string = defaultPidfile()): Promise<void> {
  const existing = await readPid(path);
  // Only remove if it's ours; never clobber a different daemon's pidfile.
  if (existing === process.pid) {
    try {
      await unlink(path);
    } catch {
      // already gone — fine
    }
  }
}

export class DaemonAlreadyRunningError extends Error {
  constructor(
    public readonly pid: number,
    public readonly pidfile: string,
  ) {
    super(`Daemon already running (pid ${pid}, pidfile ${pidfile})`);
    this.name = 'DaemonAlreadyRunningError';
  }
}
