import { apiFetch } from '../client/api.js';
import { DaemonWsClient } from '../client/daemon-client.js';

interface AgentInfo {
  id: string;
  type: string;
  status: string;
  projectPath: string;
  startedAt?: string;
  pid?: number;
}

export async function agentCommand(sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case 'ls':
    case 'list':
      await agentList(args);
      break;
    case 'run':
      await agentRun(args);
      break;
    case 'stop':
      await agentStop(args[0]);
      break;
    case 'attach':
      await agentAttach(args[0]);
      break;
    case 'send':
      await agentSend(args[0], args.slice(1).join(' '));
      break;
    case 'logs':
      await agentLogs(args[0]);
      break;
    case 'inspect':
      await agentInspect(args[0]);
      break;
    default:
      console.log(`Usage: flowwhips agent <ls|run|stop|attach|send|logs|inspect>`);
  }
}

async function agentList(args: string[]): Promise<void> {
  const showAll = args.includes('-a') || args.includes('--all');
  try {
    const agents = await apiFetch<AgentInfo[]>('/api/agents');
    const filtered = showAll ? agents : agents.filter((a) => a.status !== 'stopped');

    if (filtered.length === 0) {
      console.log(showAll ? 'No agents.' : 'No running agents. Use -a to show all.');
      return;
    }

    console.log(`${'ID'.padEnd(38)} ${'Type'.padEnd(15)} ${'Status'.padEnd(15)} Project`);
    console.log('-'.repeat(100));
    for (const a of filtered) {
      console.log(
        `${a.id.slice(0, 36).padEnd(38)} ${a.type.padEnd(15)} ${a.status.padEnd(15)} ${a.projectPath}`,
      );
    }
  } catch {
    console.error(`Failed to connect to daemon.`);
    process.exit(1);
  }
}

async function agentRun(args: string[]): Promise<void> {
  const projectPath = args.find((a) => !a.startsWith('-'));
  if (!projectPath) {
    console.error(
      'Usage: flowwhips agent run <project-path> [--provider claude-code] [--mode pty|sdk|auto] [--prompt "..."]',
    );
    process.exit(1);
  }

  const provider = args.includes('--provider')
    ? args[args.indexOf('--provider') + 1]
    : 'claude-code';
  const mode = args.includes('--mode')
    ? args[args.indexOf('--mode') + 1] as 'pty' | 'sdk' | 'auto'
    : undefined;
  const promptIdx = args.indexOf('--prompt');
  const prompt = promptIdx >= 0 ? args[promptIdx + 1] : undefined;

  try {
    const data = await apiFetch<{ sessionId: string; agentType: string; status: string }>(
      '/api/agents/start',
      {
        method: 'POST',
        body: JSON.stringify({ agentType: provider, projectPath, mode, ...(prompt ? { prompt } : {}) }),
      },
    );
    console.log(`Agent started: ${data.sessionId} (${provider}, ${mode ?? 'pty'})`);
    console.log(`  Attach:  flowwhips agent attach ${data.sessionId}`);
    console.log(`  Send:    flowwhips agent send ${data.sessionId} "your message"`);
    console.log(`  Stop:    flowwhips agent stop ${data.sessionId}`);
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function agentStop(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error('Usage: flowwhips agent stop <session-id>');
    process.exit(1);
  }
  try {
    await apiFetch('/api/agents/' + sessionId + '/stop', { method: 'POST' });
    console.log(`Agent ${sessionId} stopped.`);
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function agentAttach(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error('Usage: flowwhips agent attach <session-id>');
    process.exit(1);
  }

  const ws = new DaemonWsClient();
  console.log(`Attaching to ${sessionId}...`);

  await ws.connect();
  ws.send({ type: 'control', action: 'attach_session', sessionId });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on('data', (data) => {
    ws.send({ type: 'terminal_input', sessionId, data: data.toString() });
  });

  ws.onMessage((msg) => {
    const m = msg as { type: string; sessionId?: string; data?: string };
    if (m.type === 'terminal_output' && m.sessionId === sessionId && m.data) {
      process.stdout.write(m.data);
    }
  });

  ws.onClose(() => {
    console.log('\nDisconnected.');
    process.exit(0);
  });

  process.on('SIGINT', () => ws.close());
}

async function agentSend(sessionId?: string, message?: string): Promise<void> {
  if (!sessionId || !message) {
    console.error('Usage: flowwhips agent send <session-id> <message>');
    process.exit(1);
  }

  const ws = new DaemonWsClient();
  await ws.connect();
  ws.send({ type: 'terminal_input', sessionId, data: message + '\n' });
  console.log('Sent.');
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 500);
}

async function agentLogs(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error('Usage: flowwhips agent logs <session-id>');
    process.exit(1);
  }
  try {
    const data = await apiFetch<{ output: string[] }>(`/api/agents/${sessionId}/output`);
    for (const chunk of data.output) {
      process.stdout.write(chunk);
    }
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function agentInspect(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error('Usage: flowwhips agent inspect <session-id>');
    process.exit(1);
  }
  try {
    const agent = await apiFetch<AgentInfo>(`/api/agents/${sessionId}`);
    const events = await apiFetch<unknown[]>(`/api/agents/${sessionId}/events`);
    console.log(JSON.stringify({ ...agent, eventCount: events.length }, null, 2));
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}
