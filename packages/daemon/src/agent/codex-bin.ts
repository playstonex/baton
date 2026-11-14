import { execSync, spawn } from 'node:child_process';
import type { ModelInfo } from '@baton/shared';
import { existsSync } from 'node:fs';

/** Codex CLI bundled inside the ChatGPT desktop app (macOS). */
const CHATGPT_APP_CODEX =
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';

/**
 * Locate the codex executable: $BATON_CODEX_BIN, then PATH, then the copy
 * bundled with the ChatGPT desktop app. Returns null when none is found.
 */
export function resolveCodexBin(): string | null {
  const override = process.env.BATON_CODEX_BIN;
  if (override && existsSync(override)) return override;
  try {
    execSync('which codex', { stdio: 'pipe' });
    return 'codex';
  } catch {
    return existsSync(CHATGPT_APP_CODEX) ? CHATGPT_APP_CODEX : null;
  }
}

/** Map codex app-server `model/list` items to ModelInfo (visible models, default first). */
export function parseCodexModels(result: unknown): ModelInfo[] {
  const r = result as Record<string, unknown> | null;
  const items = ((r?.data ?? r?.models) as Array<Record<string, unknown>> | undefined) ?? [];
  return items
    .filter((m) => m.hidden !== true)
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true))
    .map((m) => {
      const id = String(m.id ?? m.model ?? m.name ?? '');
      return {
        id,
        name: String(m.displayName ?? m.name ?? m.title ?? id),
        description: typeof m.description === 'string' ? m.description : undefined,
      };
    })
    .filter((m) => m.id);
}

let modelCache: { at: number; models: ModelInfo[] } | null = null;
const MODEL_CACHE_MS = 5 * 60_000;

/**
 * Ask a short-lived `codex app-server` for the models this account can use.
 * Used before any session exists (new-chat picker). Cached; null on failure.
 */
export async function fetchCodexModels(): Promise<ModelInfo[] | null> {
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.models;
  const bin = resolveCodexBin();
  if (!bin) return null;
  return new Promise((resolve) => {
    const child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const done = (models: ModelInfo[] | null) => {
      clearTimeout(timer);
      child.kill();
      if (models && models.length > 0) modelCache = { at: Date.now(), models };
      resolve(models && models.length > 0 ? models : null);
    };
    const timer = setTimeout(() => done(null), 8000);
    child.on('error', () => done(null));
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        let msg: { id?: number; result?: unknown };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }) + '\n');
        } else if (msg.id === 2) {
          done(parseCodexModels(msg.result));
        }
      }
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'baton', version: '0' }, capabilities: {} },
      }) + '\n',
    );
  });
}
