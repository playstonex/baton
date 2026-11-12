/**
 * Tailscale Zero-Config Direct Connect Service (borrowed from T3 Code).
 *
 * Discovers local Tailscale installation, queries MagicDNS hostnames & IPv4 addresses,
 * and manages `tailscale serve` for secure HTTPS peer-to-peer connections without relays.
 */

import { spawn } from 'node:child_process';
import type { TailscaleStatusReport } from '@baton/shared';

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const [first, second] = parts.map((part) => Number.parseInt(part, 10));
  return first === 100 && second >= 64 && second <= 127;
}

export function runTailscale(
  args: string[],
  timeoutMs = 4000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500);
      reject(new Error(`tailscale ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

/**
 * Inspect Tailscale node status, MagicDNS hostname, and active serve routes.
 */
export async function getTailscaleStatus(): Promise<TailscaleStatusReport> {
  try {
    const { stdout, code } = await runTailscale(['status', '--json']);
    if (code !== 0) {
      return {
        available: true,
        online: false,
        magicDnsName: null,
        tailscaleIps: [],
        directUrl: null,
        httpsServeEnabled: null,
        serving: false,
        serveUrl: null,
        error: `tailscale status exited with code ${code}`,
      };
    }

    const data = JSON.parse(stdout);
    const self = data.Self ?? {};
    const dnsName =
      typeof self.DNSName === 'string' ? self.DNSName.trim().replace(/\.$/, '') : null;
    const rawIps: string[] = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
    const tailscaleIps = rawIps.filter(isTailscaleIpv4Address);
    const online = self.Online === true || data.BackendState === 'Running';
    const capMap = self.CapMap;
    const httpsServeEnabled =
      typeof capMap === 'object' && capMap !== null && !Array.isArray(capMap)
        ? Object.hasOwn(capMap, 'https')
        : null;

    let serving = false;
    let serveUrl: string | null = null;
    try {
      const serveRes = await runTailscale(['serve', 'status', '--json'], 3000);
      if (serveRes.code === 0 && serveRes.stdout.trim()) {
        const serveData = JSON.parse(serveRes.stdout);
        if (serveData.Web && Object.keys(serveData.Web).length > 0) {
          serving = true;
          if (dnsName) {
            serveUrl = `https://${dnsName}`;
          }
        }
      }
    } catch {
      // serve status might not be supported on older versions
    }

    const directUrl = dnsName
      ? `http://${dnsName}:3210`
      : tailscaleIps.length > 0
        ? `http://${tailscaleIps[0]}:3210`
        : null;

    return {
      available: true,
      online,
      magicDnsName: dnsName,
      tailscaleIps,
      directUrl,
      httpsServeEnabled,
      serving,
      serveUrl,
    };
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    const isNotFound = errorObj?.code === 'ENOENT' || String(err).includes('ENOENT');
    return {
      available: !isNotFound,
      online: false,
      magicDnsName: null,
      tailscaleIps: [],
      directUrl: null,
      httpsServeEnabled: null,
      serving: false,
      serveUrl: null,
      error: isNotFound ? 'Tailscale CLI not found' : (errorObj?.message ?? String(err)),
    };
  }
}

/**
 * Configure Tailscale HTTPS serve reverse proxy to local daemon port.
 */
export async function enableTailscaleServe(opts: {
  localPort?: number;
  servePort?: number;
}): Promise<{ ok: boolean; serveUrl?: string; error?: string }> {
  const localPort = opts.localPort ?? 3210;
  const servePort = opts.servePort ?? 443;
  const args = ['serve', '--bg', `--https=${servePort}`, `http://127.0.0.1:${localPort}`];

  try {
    const { code, stderr } = await runTailscale(args, 10000);
    if (code !== 0) {
      return { ok: false, error: stderr.trim() || `Exit code ${code}` };
    }
    const status = await getTailscaleStatus();
    const serveUrl = status.magicDnsName
      ? `https://${status.magicDnsName}${servePort === 443 ? '' : `:${servePort}`}`
      : undefined;
    return { ok: true, serveUrl };
  } catch (err: unknown) {
    const errorObj = err as { message?: string };
    return { ok: false, error: errorObj?.message ?? String(err) };
  }
}

/**
 * Disable Tailscale HTTPS serve.
 */
export async function disableTailscaleServe(opts?: {
  servePort?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const servePort = opts?.servePort ?? 443;
  const args = ['serve', `--https=${servePort}`, 'off'];
  try {
    const { code, stderr } = await runTailscale(args, 10000);
    if (code !== 0) {
      return { ok: false, error: stderr.trim() || `Exit code ${code}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    const errorObj = err as { message?: string };
    return { ok: false, error: errorObj?.message ?? String(err) };
  }
}
