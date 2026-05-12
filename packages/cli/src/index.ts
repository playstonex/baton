#!/usr/bin/env node
import { daemonCommand } from './commands/daemon.js';
import { agentCommand } from './commands/agent.js';
import { providerCommand } from './commands/provider.js';
import { pipelineCommand } from './commands/pipeline.js';
import { worktreeCommand } from './commands/worktree.js';
import { doctorCommand } from './commands/doctor.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

async function main() {
  switch (command) {
    case 'daemon':
      await daemonCommand(args[1], args.slice(2));
      break;
    case 'agent':
      await agentCommand(args[1], args.slice(2));
      break;
    case 'provider':
      await providerCommand(args[1], args.slice(2));
      break;
    case 'pipeline':
      await pipelineCommand(args[1], args.slice(2));
      break;
    case 'worktree':
      await worktreeCommand(args[1], args.slice(2));
      break;
    case 'doctor':
      await doctorCommand();
      break;

    // Legacy shortcuts (backward compat)
    case 'start':
      await agentCommand('run', [args[1] ?? '', ...args.slice(2)]);
      break;
    case 'ls':
    case 'list':
      await agentCommand('ls', args.slice(1));
      break;
    case 'attach':
      await agentCommand('attach', [args[1]]);
      break;
    case 'send':
      await agentCommand('send', [args[1], args.slice(2).join(' ')]);
      break;
    case 'stop':
      await agentCommand('stop', [args[1]]);
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
  Baton CLI v0.0.1

  Usage:
    baton daemon start [--foreground]       Start the daemon
    baton daemon stop                        Stop the daemon
    baton daemon status                      Show daemon status
    baton daemon pair                        Generate QR pairing code

    baton agent run <path> [--provider X]   Start an agent
    baton agent ls [-a]                      List agents
    baton agent attach <session-id>          Attach to terminal
    baton agent send <session-id> <msg>      Send input
    baton agent stop <session-id>            Stop an agent
    baton agent logs <session-id>            Show output history
    baton agent inspect <session-id>         Show agent details

    baton provider ls                        List providers
    baton provider models <provider>         List models

    baton pipeline create --name X --steps   Create pipeline
    baton pipeline run <id>                  Run pipeline
    baton pipeline ls                        List pipelines

    baton worktree ls                        List worktrees
    baton worktree create <path> --branch X  Create worktree
    baton worktree archive <path>            Archive worktree

    baton doctor                              Run diagnostics

  Legacy shortcuts:
    baton start <path>     = agent run
    baton ls               = agent ls
    baton attach <id>      = agent attach
    baton send <id> <msg>  = agent send
    baton stop <id>        = agent stop

  Environment:
    BATON_URL   Daemon URL (default: http://localhost:3210)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
