#!/usr/bin/env node
import { WebSocket } from 'ws';

const DAEMON_URL = process.env.FLOWWHIPS_URL ?? 'http://localhost:3210';
const WS_URL = DAEMON_URL.replace(/^http/, 'ws').replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`);

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

switch (command) {
  case 'start':
    cmdStart(args[1]);
    break;
  case 'ls':
  case 'list':
    cmdList();
    break;
  case 'attach':
    cmdAttach(args[1]);
    break;
  case 'send':
    cmdSend(args[1], args.slice(2).join(' '));
    break;
  case 'stop':
    cmdStop(args[1]);
    break;
  case 'help':
  default:
    printHelp();
    break;
}

function printHelp() {
  console.log(`
  FlowWhips CLI v0.0.1

  Usage:
    flowwhips start <project-path>   Start a Claude Code agent
    flowwhips ls                     List running agents
    flowwhips attach <session-id>    Attach to agent terminal
    flowwhips send <session-id> <msg> Send input to agent
    flowwhips stop <session-id>      Stop an agent

  Environment:
    FLOWWHIPS_URL   Daemon URL (default: http://localhost:3210)
`);
}

async function cmdStart(projectPath?: string) {
  if (!projectPath) {
    console.error('Usage: flowwhips start <project-path>');
    process.exit(1);
  }

  const agentType = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'claude-code';

  try {
    const res = await fetch(`${DAEMON_URL}/api/agents/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentType, projectPath }),
    });
    const data = (await res.json()) as { sessionId?: string; error?: string };
    if (!res.ok) {
      console.error(`Error: ${data.error}`);
      process.exit(1);
    }
    console.log(`Agent started: ${data.sessionId} (${agentType})`);
    console.log(`  Attach: flowwhips attach ${data.sessionId}`);
  } catch (err) {
    console.error(`Failed to connect to daemon at ${DAEMON_URL}`);
    console.error(err);
    process.exit(1);
  }
}

async function cmdList() {
  try {
    const res = await fetch(`${DAEMON_URL}/api/agents`);
    const agents = (await res.json()) as Array<{ id: string; type: string; status: string; projectPath: string; startedAt?: string }>;

    if (agents.length === 0) {
      console.log('No agents running.');
      return;
    }

    console.log(`${'ID'.padEnd(38)} ${'Type'.padEnd(15)} ${'Status'.padEnd(15)} Project`);
    console.log('-'.repeat(100));
    for (const a of agents) {
      const id = a.id.slice(0, 36);
      console.log(`${id.padEnd(38)} ${a.type.padEnd(15)} ${a.status.padEnd(15)} ${a.projectPath}`);
    }
  } catch {
    console.error(`Failed to connect to daemon at ${DAEMON_URL}`);
    process.exit(1);
  }
}

function cmdAttach(sessionId?: string) {
  if (!sessionId) {
    console.error('Usage: flowwhips attach <session-id>');
    process.exit(1);
  }

  console.log(`Attaching to session ${sessionId}...`);
  console.log(`Connecting to ${WS_URL}`);

  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'control', action: 'attach_session', sessionId }));

    // Forward stdin to agent
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('data', (data) => {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data: data.toString() }));
    });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        process.stdout.write(msg.data);
      }
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    console.log('\nDisconnected.');
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    ws.close();
  });
}

async function cmdSend(sessionId?: string, message?: string) {
  if (!sessionId || !message) {
    console.error('Usage: flowwhips send <session-id> <message>');
    process.exit(1);
  }

  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data: message + '\n' }));
    console.log('Sent.');
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 500);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    process.exit(1);
  });
}

async function cmdStop(sessionId?: string) {
  if (!sessionId) {
    console.error('Usage: flowwhips stop <session-id>');
    process.exit(1);
  }

  try {
    const res = await fetch(`${DAEMON_URL}/api/agents/${sessionId}/stop`, { method: 'POST' });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      console.log(`Agent ${sessionId} stopped.`);
    } else {
      console.error(`Error: ${data.error ?? 'Unknown error'}`);
    }
  } catch {
    console.error(`Failed to connect to daemon at ${DAEMON_URL}`);
    process.exit(1);
  }
}
