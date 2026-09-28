import { apiFetch, DAEMON_URL, WS_URL } from '../client/api.js';
import { execSync } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export async function doctorCommand(): Promise<void> {
  const checks: CheckResult[] = [];

  console.log('Baton Doctor — Diagnostic Report\n');

  checks.push(await checkDaemonHealth());
  checks.push(await checkDaemonWS());
  checks.push(checkBun());
  checks.push(checkNode());
  checks.push(checkGh());
  checks.push(checkProviderPlugins());
  checks.push(await checkPtyBinary());
  checks.push(await checkBatonHome());

  const maxName = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    const color = c.pass ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`  ${color}${icon}${reset}  ${c.name.padEnd(maxName)}  ${c.detail}`);
  }

  const failures = checks.filter((c) => !c.pass).length;
  console.log(
    `\n${failures === 0 ? '\x1b[32mAll checks passed.\x1b[0m' : `\x1b[31m${failures} check(s) failed.\x1b[0m`}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

async function checkDaemonHealth(): Promise<CheckResult> {
  try {
    const data = await apiFetch<{ status: string; version: string }>(`/api/health`);
    return { name: 'Daemon HTTP', pass: true, detail: `${DAEMON_URL} — v${data.version} (${data.status})` };
  } catch {
    return { name: 'Daemon HTTP', pass: false, detail: `Not reachable at ${DAEMON_URL}` };
  }
}

async function checkDaemonWS(): Promise<CheckResult> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ name: 'Daemon WS', pass: false, detail: `Timeout at ${WS_URL}` });
      }, 3000);
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ name: 'Daemon WS', pass: true, detail: `${WS_URL} — connected` });
      });
      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        resolve({ name: 'Daemon WS', pass: false, detail: `Not reachable at ${WS_URL}` });
      });
    } catch {
      resolve({ name: 'Daemon WS', pass: false, detail: `Failed to connect to ${WS_URL}` });
    }
  });
}

function checkBun(): CheckResult {
  try {
    const version = execSync('bun --version', { encoding: 'utf-8' }).trim();
    const major = parseInt(version.split('.')[0], 10);
    return { name: 'Bun', pass: major >= 1, detail: `v${version}${major < 1 ? ' (requires >= 1.0)' : ''}` };
  } catch {
    return { name: 'Bun', pass: false, detail: 'Not installed' };
  }
}

function checkNode(): CheckResult {
  try {
    const version = execSync('node --version', { encoding: 'utf-8' }).trim();
    const major = parseInt(version.replace(/^v/, '').split('.')[0], 10);
    return { name: 'Node.js', pass: major >= 22, detail: `${version}${major < 22 ? ' (requires >= 22)' : ''}` };
  } catch {
    return { name: 'Node.js', pass: false, detail: 'Not installed' };
  }
}

function checkGh(): CheckResult {
  // The GitHub CLI is OPTIONAL — only the Forge (Pull Requests) feature needs
  // it. Absence must not fail the whole doctor, so this check always passes and
  // encodes presence in the detail line.
  try {
    const version = execSync('gh --version', { encoding: 'utf-8' }).trim().split('\n')[0];
    let authed = false;
    try {
      execSync('gh auth status', { encoding: 'utf-8', stdio: 'pipe' });
      authed = true;
    } catch {
      authed = false;
    }
    return {
      name: 'GitHub CLI',
      pass: true,
      detail: `${version}${authed ? ' (authenticated)' : " — not authenticated; run 'gh auth login' for Forge features"}`,
    };
  } catch {
    return {
      name: 'GitHub CLI',
      pass: true,
      detail: 'Not installed (optional — required only for Forge / Pull Requests features)',
    };
  }
}

function checkProviderPlugins(): CheckResult {
  // Third-party provider plugins are OPTIONAL — list what's installed in
  // $BATON_HOME/plugins so users can confirm their provider was picked up.
  // Purely informational: pass is always true.
  const dir = join(process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`, 'plugins');
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    const manifests = entries
      .map((e) => {
        try {
          const m = JSON.parse(readFileSync(join(dir, e.name, 'plugin.json'), 'utf-8')) as {
            type?: string;
            version?: string;
          };
          return `${e.name} (${m.type ?? '?'}${m.version ? ` v${m.version}` : ''})`;
        } catch {
          return `${e.name} (invalid manifest)`;
        }
      });
    return {
      name: 'Provider Plugins',
      pass: true,
      detail:
        manifests.length > 0
          ? manifests.join(', ')
          : 'None installed (drop a plugin dir under ~/.baton/plugins to extend agents)',
    };
  } catch {
    return {
      name: 'Provider Plugins',
      pass: true,
      detail: 'No plugins directory (none installed)',
    };
  }
}

async function checkPtyBinary(): Promise<CheckResult> {
  const candidates = [
    process.env.BATON_PTY_PATH,
    join(process.cwd(), 'packages/daemon/pty/target/release/baton-pty'),
    join(process.env.HOME ?? '~', '.baton/pty/baton-pty'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      await access(p, constants.X_OK);
      return { name: 'PTY Binary', pass: true, detail: p };
    } catch {
      continue;
    }
  }
  return { name: 'PTY Binary', pass: false, detail: `Not found (searched ${candidates.length} paths)` };
}

async function checkBatonHome(): Promise<CheckResult> {
  const home = process.env.BATON_HOME ?? join(process.env.HOME ?? '~', '.baton');
  try {
    await access(home, constants.W_OK);
    return { name: 'Baton Home', pass: true, detail: `${home} (writable)` };
  } catch {
    try {
      await access(home);
      return { name: 'Baton Home', pass: false, detail: `${home} (not writable)` };
    } catch {
      return { name: 'Baton Home', pass: false, detail: `${home} (does not exist)` };
    }
  }
}
