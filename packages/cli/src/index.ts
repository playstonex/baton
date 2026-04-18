#!/usr/bin/env node
import { daemonCommand } from './commands/daemon.js';
import { agentCommand } from './commands/agent.js';
import { providerCommand } from './commands/provider.js';
import { pipelineCommand } from './commands/pipeline.js';
import { worktreeCommand } from './commands/worktree.js';

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
  FlowWhips CLI v0.0.1

  Usage:
    flowwhips daemon start [--foreground]       Start the daemon
    flowwhips daemon stop                        Stop the daemon
    flowwhips daemon status                      Show daemon status
    flowwhips daemon pair                        Generate QR pairing code

    flowwhips agent run <path> [--provider X]   Start an agent
    flowwhips agent ls [-a]                      List agents
    flowwhips agent attach <session-id>          Attach to terminal
    flowwhips agent send <session-id> <msg>      Send input
    flowwhips agent stop <session-id>            Stop an agent
    flowwhips agent logs <session-id>            Show output history
    flowwhips agent inspect <session-id>         Show agent details

    flowwhips provider ls                        List providers
    flowwhips provider models <provider>         List models

    flowwhips pipeline create --name X --steps   Create pipeline
    flowwhips pipeline run <id>                  Run pipeline
    flowwhips pipeline ls                        List pipelines

    flowwhips worktree ls                        List worktrees
    flowwhips worktree create <path> --branch X  Create worktree
    flowwhips worktree archive <path>            Archive worktree

  Legacy shortcuts:
    flowwhips start <path>     = agent run
    flowwhips ls               = agent ls
    flowwhips attach <id>      = agent attach
    flowwhips send <id> <msg>  = agent send
    flowwhips stop <id>        = agent stop

  Environment:
    FLOWWHIPS_URL   Daemon URL (default: http://localhost:3210)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
