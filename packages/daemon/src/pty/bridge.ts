import { spawn as bunSpawn } from 'bun';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface IPty {
  pid: number;
  kill(signal?: string): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

type Command =
  | { type: 'spawn'; command: string; args: string[]; cwd: string; env: [string, string][]; cols: number; rows: number }
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill'; signal?: string };

type Event =
  | { type: 'ready'; pid: number }
  | { type: 'output'; data: string }
  | { type: 'render'; cols: number; rows: number; cells: CellUpdate[] }
  | { type: 'exit'; code: number; signal?: number }
  | { type: 'error'; message: string };

interface CellUpdate {
  row: number;
  col: number;
  text: string;
  fg?: string;
  bg?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function findPtyBinary(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(__dirname, '..', '..', 'pty', 'target', 'release', 'flowwhips-pty'),
    join(__dirname, '..', '..', 'pty', 'target', 'debug', 'flowwhips-pty'),
  ];
  return candidates[0];
}

export async function spawnPty(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
  },
): Promise<IPty> {
  const binaryPath = findPtyBinary();
  const envPairs: [string, string][] = Object.entries(options.env);

  const proc = bunSpawn({
    cmd: [binaryPath],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const dataCallbacks = new Set<(data: string) => void>();
  const exitCallbacks = new Set<(e: { exitCode: number; signal?: number }) => void>();
  let readyPid = 0;
  let settled = false;

  const sendCommand = (cmd: Command): void => {
    const line = JSON.stringify(cmd) + '\n';
    proc.stdin.write(line);
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Rust PTY binary failed to start (timeout waiting for ready)'));
      }
    }, 10000);

    const readStdout = async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event: Event = JSON.parse(line);

              switch (event.type) {
                case 'ready':
                  readyPid = event.pid;
                  settled = true;
                  clearTimeout(timeout);
                  resolve();
                  break;
                case 'output':
                  for (const cb of dataCallbacks) cb(event.data);
                  break;
                case 'exit':
                  for (const cb of exitCallbacks) cb({ exitCode: event.code, signal: event.signal });
                  break;
                case 'error':
                  console.error('Rust PTY error:', event.message);
                  if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(event.message));
                  }
                  break;
              }
            } catch {
              // Non-JSON line, ignore
            }
          }
        }
      } catch {
        // Stream closed
      }
    };

    readStdout();
  });

  sendCommand({
    type: 'spawn',
    command,
    args,
    cwd: options.cwd,
    env: envPairs,
    cols: options.cols,
    rows: options.rows,
  });

  await readyPromise;

  const pty: IPty = {
    get pid() { return readyPid; },
    kill(signal?: string) {
      sendCommand({ type: 'kill', signal });
    },
    write(data: string) {
      sendCommand({ type: 'write', data });
    },
    resize(cols: number, rows: number) {
      sendCommand({ type: 'resize', cols, rows });
    },
    onData(cb: (data: string) => void) {
      dataCallbacks.add(cb);
    },
    onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
      exitCallbacks.add(cb);
    },
  };

  return pty;
}
