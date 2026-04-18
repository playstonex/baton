import { apiFetch, DAEMON_URL } from '../client/api.js';

export async function daemonCommand(sub: string, _args: string[]): Promise<void> {
  switch (sub) {
    case 'start':
      await daemonStart(_args);
      break;
    case 'stop':
      await daemonStop();
      break;
    case 'status':
      await daemonStatus();
      break;
    case 'pair':
      await daemonPair();
      break;
    default:
      console.log(`Usage: flowwhips daemon <start|stop|status|pair>`);
  }
}

async function daemonStart(args: string[]): Promise<void> {
  const foreground = args.includes('--foreground') || args.includes('-f');

  if (foreground) {
    console.log(`Starting daemon in foreground on ${DAEMON_URL}...`);
    console.log('(Use the daemon process directly for foreground mode)');
    return;
  }

  try {
    const health = await apiFetch<{ status: string }>('/api/health');
    console.log(`Daemon already running (status: ${health.status})`);
  } catch {
    console.log(`Daemon not running. Start it with: pnpm --filter @flowwhips/daemon dev`);
  }
}

async function daemonStop(): Promise<void> {
  try {
    const health = await apiFetch<{ status: string }>('/api/health');
    console.log(`Daemon is running at ${DAEMON_URL} (status: ${health.status})`);
    console.log('Send SIGINT to the daemon process to stop it.');
  } catch {
    console.log('Daemon is not running.');
  }
}

async function daemonStatus(): Promise<void> {
  try {
    const data = await apiFetch<{ status: string; version: string; relay: boolean }>('/api/health');
    const host = await apiFetch<{
      id: string;
      name: string;
      os: string;
      status: string;
      agents: unknown[];
    }>('/api/host');
    console.log(`Daemon: ${data.status} (v${data.version})`);
    console.log(`Host:   ${host.name} (${host.os})`);
    console.log(`Agents: ${host.agents.length}`);
    console.log(`Relay:  ${data.relay ? 'connected' : 'disconnected'}`);
  } catch {
    console.log('Daemon is not running.');
    console.log(`Expected at: ${DAEMON_URL}`);
  }
}

async function daemonPair(): Promise<void> {
  try {
    const data = await apiFetch<{ qr: string; fingerprint: string; relayUrl: string }>(
      '/api/pair/qr',
    );
    console.log(`\nPairing QR Code generated:`);
    console.log(`Fingerprint: ${data.fingerprint}`);
    console.log(`Relay:       ${data.relayUrl}`);
    console.log(`\nScan the QR code in the FlowWhips mobile app.\n`);
    console.log(data.qr);
  } catch (err) {
    console.error('Failed to generate pairing QR:', err instanceof Error ? err.message : err);
  }
}
