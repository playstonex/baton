import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readPid,
  isProcessAlive,
  releasePid,
  defaultPidfile,
  DaemonAlreadyRunningError,
} from '@baton/shared';
import { apiFetch, DAEMON_URL } from '../client/api.js';

export async function daemonCommand(sub: string, args: string[]): Promise<void> {
  const json = args.includes('--json');

  switch (sub) {
    case 'start':
      await daemonStart(args, json);
      break;
    case 'stop':
      await daemonStop(json);
      break;
    case 'restart':
      await daemonRestart(args, json);
      break;
    case 'status':
      await daemonStatus(json);
      break;
    case 'watch':
      await daemonWatch(args);
      break;
    case 'pair':
      await daemonPair(json);
      break;
    default:
      if (json) {
        console.log(JSON.stringify({ ok: false, error: `unknown subcommand: ${sub}` }));
      } else {
        console.log(`Usage: baton daemon <start|stop|restart|status|watch|pair> [--json]`);
      }
  }
}

/**
 * Locate the daemon's entry script. In the monorepo this is the sibling
 * packages/daemon/src/index.ts (run via bun in dev). For a published install,
 * fall back to the compiled binary on PATH.
 */
function findDaemonEntry(): { cmd: string; args: string[] } | null {
  // Monorepo layout: from packages/cli/src/commands the daemon source sits at
  // ../../../daemon/src/index.ts.
  const here = resolve(import.meta.dirname ?? __dirname);
  for (const candidate of [
    resolve(here, '../../../daemon/src/index.ts'),
    resolve(here, '../../../../daemon/src/index.ts'),
  ]) {
    if (existsSync(candidate)) {
      return { cmd: 'bun', args: ['run', candidate] };
    }
  }
  // Published binary fallback.
  return { cmd: 'baton-daemon', args: [] };
}

function emitJson(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

async function daemonStart(args: string[], json: boolean): Promise<void> {
  const foreground = args.includes('--foreground') || args.includes('-f');

  // Refuse if a live daemon is already running.
  const pid = await readPid();
  if (pid !== null && isProcessAlive(pid)) {
    const err = new DaemonAlreadyRunningError(pid, defaultPidfile());
    if (json) {
      emitJson({ ok: false, error: err.message, pid, pidfile: err.pidfile });
    } else {
      console.error(`✗ ${err.message}`);
      console.error(`  Run \`baton daemon stop\` first.`);
    }
    process.exit(1);
  }

  const entry = findDaemonEntry();
  if (!entry) {
    if (json) emitJson({ ok: false, error: 'daemon entry not found' });
    else console.error('✗ Could not locate the daemon entry script.');
    process.exit(1);
  }

  const env = { ...process.env };
  if (json) console.log(JSON.stringify({ ok: true, status: 'starting', url: DAEMON_URL }));

  if (foreground) {
    // Inherit stdio so the daemon's logs stream to this terminal.
    const child = spawn(entry.cmd, [...entry.args], {
      stdio: 'inherit',
      env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  // Background: detach so the daemon survives the CLI exiting.
  const child = spawn(entry.cmd, [...entry.args], {
    stdio: 'ignore',
    detached: true,
    env,
  }).on('spawn', () => {
    // Wait briefly for the pidfile to appear, then report.
    setTimeout(async () => {
      const newPid = await readPid();
      if (json) {
        emitJson({ ok: true, status: 'started', pid: newPid, url: DAEMON_URL });
      } else {
        console.log(`✓ Daemon started (pid ${newPid ?? 'unknown'}) on ${DAEMON_URL}`);
      }
    }, 800);
  });
  child.unref();
}

async function daemonStop(json: boolean): Promise<void> {
  const pid = await readPid();
  if (pid === null || !isProcessAlive(pid)) {
    // Stale or missing pidfile — clean up just in case.
    await releasePid();
    if (json) emitJson({ ok: true, status: 'not_running' });
    else console.log('Daemon is not running.');
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (json) emitJson({ ok: false, error: `failed to signal pid ${pid}` });
    else console.error(`✗ Failed to stop daemon: ${err}`);
    process.exit(1);
  }

  // Wait for the process to exit (poll up to ~5s).
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (isProcessAlive(pid)) {
    // Escalate.
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* best effort */
    }
  }

  if (json) emitJson({ ok: true, status: 'stopped', pid });
  else console.log(`✓ Daemon stopped (pid ${pid}).`);
}

async function daemonRestart(args: string[], json: boolean): Promise<void> {
  await daemonStop(json);
  await new Promise((r) => setTimeout(r, 500));
  await daemonStart(args, json);
}

async function daemonStatus(json: boolean): Promise<void> {
  const pid = await readPid();
  const pidAlive = pid !== null && isProcessAlive(pid);

  let healthOk = false;
  let version: string | undefined;
  let relay = false;
  let agentCount = 0;
  let hostName: string | undefined;

  if (pidAlive) {
    try {
      const data = await apiFetch<{ status: string; version: string; relay: boolean }>(
        '/api/health',
      );
      const host = await apiFetch<{ name: string; agents: unknown[] }>('/api/host');
      healthOk = data.status === 'ok';
      version = data.version;
      relay = data.relay;
      agentCount = host.agents.length;
      hostName = host.name;
    } catch {
      // Process alive but HTTP not responding yet — partial state.
    }
  }

  const status = !pidAlive ? 'stopped' : healthOk ? 'running' : 'starting';

  if (json) {
    emitJson({
      ok: true,
      status,
      pid: pid ?? null,
      version,
      url: DAEMON_URL,
      relay,
      agents: agentCount,
      host: hostName,
    });
    return;
  }

  if (status === 'stopped') {
    console.log('Daemon is not running.');
    console.log(`Expected at: ${DAEMON_URL}`);
    return;
  }
  console.log(`Daemon: ${status} (v${version ?? '?'})`);
  if (pid) console.log(`PID:    ${pid}`);
  if (hostName) console.log(`Host:   ${hostName}`);
  console.log(`URL:    ${DAEMON_URL}`);
  console.log(`Agents: ${agentCount}`);
  console.log(`Relay:  ${relay ? 'connected' : 'disconnected'}`);
}

async function daemonPair(json: boolean): Promise<void> {
  try {
    const data = await apiFetch<{
      qr: string;
      qrTerminal?: string;
      fingerprint: string;
      relayUrl: string;
      localHttpUrl?: string;
      localWsUrl?: string;
      name?: string;
      payload?: string;
    }>('/api/pair/qr');
    if (json) {
      emitJson({
        ok: true,
        fingerprint: data.fingerprint,
        relayUrl: data.relayUrl,
        localHttpUrl: data.localHttpUrl,
        localWsUrl: data.localWsUrl,
        name: data.name,
        payload: data.payload,
      });
      return;
    }
    console.log(`\n================ Baton Pairing ================`);
    if (data.name) console.log(`Host:        ${data.name}`);
    if (data.localHttpUrl) console.log(`Local (LAN): ${data.localHttpUrl}`);
    console.log(`Relay:       ${data.relayUrl}`);
    console.log(`Fingerprint: ${data.fingerprint}`);
    console.log(`\nScan this QR code in the Baton mobile app to connect:\n`);
    if (data.qrTerminal) {
      console.log(data.qrTerminal);
    } else {
      console.log(data.qr);
    }
    console.log(`===============================================\n`);
  } catch (err) {
    if (json) emitJson({ ok: false, error: 'failed to generate pairing QR' });
    else console.error('Failed to generate pairing QR:', err instanceof Error ? err.message : err);
  }
}

/**
 * Live status stream — the lightweight companion to a full menubar app.
 * Polls the daemon health + host endpoints on an interval and prints a
 * refreshed single-line status. Ctrl-C to stop.
 *
 * This is the downgraded form of the macOS menubar companion: a CLI that any
 * future desktop app or script can consume. A full Swift menubar app is a
 * separate project; this gives the same observable signal now.
 */
async function daemonWatch(args: string[]): Promise<void> {
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalMs = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 2000;

  // Render helper — clears the line and reprints. Uses ANSI cursor control so
  // the output stays on one line (terminal-friendly, like `top`/`watch`).
  const render = (line: string) => {
    process.stdout.write(`\r\x1b[K${line}`);
  };

  let lastStatus = '';
  console.log(`Watching ${DAEMON_URL} (interval ${intervalMs}ms, Ctrl-C to stop)\n`);

  const tick = async () => {
    try {
      const data = await apiFetch<{ status: string; version: string } & Record<string, unknown>>(
        '/api/health',
      );
      const host = await apiFetch<{ name: string; agents: unknown[] }>('/api/host').catch(() => ({
        name: '?',
        agents: [],
      }));
      const status = data.status === 'ok' ? 'running' : 'degraded';
      const indicator = status === 'running' ? '\x1b[32m●\x1b[0m' : '\x1b[33m●\x1b[0m';
      const line = `${indicator} ${status} | v${data.version} | host ${host.name} | agents ${host.agents.length}`;
      if (line !== lastStatus) {
        render(line);
        lastStatus = line;
      }
    } catch {
      const line = '\x1b[31m●\x1b[0m offline';
      if (line !== lastStatus) {
        render(line);
        lastStatus = line;
      }
    }
  };

  await tick();
  const timer = setInterval(tick, intervalMs);

  // Graceful exit on Ctrl-C.
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('\n');
    process.exit(0);
  });

  // Keep the process alive.
  return new Promise(() => {});
}
