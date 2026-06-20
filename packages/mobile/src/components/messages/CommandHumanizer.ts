export interface HumanizedCommand {
  verb: string;
  target: string;
}

function unwrapShell(raw: string): string {
  let result = raw.trim();

  const lowered = result.toLowerCase();
  const shellPrefixes = [
    '/usr/bin/env bash -c ',
    '/usr/bin/bash -lc ',
    '/usr/bin/bash -c ',
    '/bin/bash -lc ',
    '/bin/bash -c ',
    '/bin/zsh -lc ',
    '/bin/zsh -c ',
    'bash -lc ',
    'bash -c ',
    '/bin/sh -c ',
    'sh -c ',
  ];

  for (const prefix of shellPrefixes) {
    if (!lowered.startsWith(prefix)) continue;
    result = result.slice(prefix.length);
    if (
      (result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))
    ) {
      result = result.slice(1, -1);
    }
    const andIdx = result.indexOf('&&');
    if (andIdx !== -1) {
      result = result.slice(andIdx + 2).trim();
    }
    break;
  }

  const pipeIdx = result.indexOf(' | ');
  if (pipeIdx !== -1) {
    result = result.slice(0, pipeIdx).trim();
  }

  return result;
}

function splitToolAndArgs(command: string): [string, string] {
  const spaceIdx = command.indexOf(' ');
  if (spaceIdx === -1) return [command.toLowerCase(), ''];
  const rawTool = command.slice(0, spaceIdx);
  const tool = rawTool.includes('/') ? rawTool.slice(rawTool.lastIndexOf('/') + 1).toLowerCase() : rawTool.toLowerCase();
  return [tool, command.slice(spaceIdx + 1)];
}

function compactPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return parts.slice(-2).join('/');
}

function lastPathComponents(args: string, fallback: string): string {
  const tokens = args.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    let s = tokens[i].replace(/^["']|["']$/g, '');
    if (!s || s.startsWith('-')) continue;
    return compactPath(s);
  }
  return fallback;
}

function extractSearchPatternAndPath(args: string): [string | null, string | null] {
  const chars = args;
  const tokens: string[] = [];
  let i = 0;

  while (i < chars.length) {
    while (i < chars.length && chars[i] === ' ') i++;
    if (i >= chars.length) break;

    if (chars[i] === '"' || chars[i] === "'") {
      const quote = chars[i];
      i++;
      let buf = '';
      while (i < chars.length && chars[i] !== quote) {
        if (chars[i] === '\\' && i + 1 < chars.length) {
          buf += chars[i + 1];
          i += 2;
        } else {
          buf += chars[i];
          i++;
        }
      }
      if (i < chars.length) i++;
      tokens.push(buf);
    } else {
      let buf = '';
      while (i < chars.length && chars[i] !== ' ') {
        buf += chars[i];
        i++;
      }
      tokens.push(buf);
    }
  }

  let pattern: string | null = null;
  let path: string | null = null;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith('-')) {
      if (['-t', '-g', '--type', '--glob', '--max-count'].includes(token)) {
        skipNext = true;
      }
      continue;
    }
    if (pattern === null) {
      pattern = token.length > 30 ? token.slice(0, 27) + '...' : token;
    } else if (path === null) {
      path = compactPath(token);
    }
  }

  return [pattern, path];
}

function searchSummary(args: string): string {
  const [pattern, path] = extractSearchPatternAndPath(args);
  const displayPattern = pattern ?? '...';
  if (path) return `for ${displayPattern} in ${path}`;
  return `for ${displayPattern}`;
}

function gitInfo(args: string, isRunning: boolean): HumanizedCommand {
  const spaceIdx = args.indexOf(' ');
  const sub = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : args.slice(spaceIdx + 1);

  switch (sub) {
    case 'status':
      return { verb: isRunning ? 'Checking' : 'Checked', target: 'git status' };
    case 'diff':
      return { verb: isRunning ? 'Comparing' : 'Compared', target: 'changes' };
    case 'log':
      return { verb: isRunning ? 'Viewing' : 'Viewed', target: 'git log' };
    case 'add':
      return { verb: isRunning ? 'Staging' : 'Staged', target: 'changes' };
    case 'commit':
      return { verb: isRunning ? 'Committing' : 'Committed', target: 'changes' };
    case 'push':
      return { verb: isRunning ? 'Pushing' : 'Pushed', target: 'to remote' };
    case 'pull':
      return { verb: isRunning ? 'Pulling' : 'Pulled', target: 'from remote' };
    case 'checkout':
    case 'switch': {
      const branchParts = rest.split(/\s+/);
      const branch = branchParts[branchParts.length - 1] || '';
      return {
        verb: isRunning ? 'Switching to' : 'Switched to',
        target: branch || 'branch',
      };
    }
    default:
      return { verb: isRunning ? 'Running' : 'Ran', target: `git ${args}` };
  }
}

export function humanizeCommand(raw: string, isRunning: boolean): HumanizedCommand {
  const command = unwrapShell(raw);
  const [tool, args] = splitToolAndArgs(command);

  switch (tool) {
    case 'cat':
    case 'nl':
    case 'head':
    case 'tail':
    case 'sed':
    case 'less':
    case 'more':
      return {
        verb: isRunning ? 'Reading' : 'Read',
        target: lastPathComponents(args, 'file'),
      };
    case 'rg':
    case 'grep':
    case 'ag':
    case 'ack':
      return {
        verb: isRunning ? 'Searching' : 'Searched',
        target: searchSummary(args),
      };
    case 'ls':
      return {
        verb: isRunning ? 'Listing' : 'Listed',
        target: lastPathComponents(args, 'directory'),
      };
    case 'find':
    case 'fd':
      return {
        verb: isRunning ? 'Finding' : 'Found',
        target: lastPathComponents(args, 'files'),
      };
    case 'mkdir':
      return {
        verb: isRunning ? 'Creating' : 'Created',
        target: lastPathComponents(args, 'directory'),
      };
    case 'rm':
      return {
        verb: isRunning ? 'Removing' : 'Removed',
        target: lastPathComponents(args, 'file'),
      };
    case 'cp':
      return {
        verb: isRunning ? 'Copying' : 'Copied',
        target: lastPathComponents(args, 'file'),
      };
    case 'mv':
      return {
        verb: isRunning ? 'Moving' : 'Moved',
        target: lastPathComponents(args, 'file'),
      };
    case 'git':
      return gitInfo(args, isRunning);
    default:
      return {
        verb: isRunning ? 'Running' : 'Ran',
        target: command,
      };
  }
}
