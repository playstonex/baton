import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Load `~/.baton/.env` (BATON_HOME/.env) into `process.env` as a fallback.
 *
 * This exists so API keys (e.g. `GLM_CODEX_API_KEY`) are available to the
 * daemon regardless of how it was launched — terminal, mobile-app pairing,
 * launchd, or reboot. A backgrounded/detached daemon does not inherit the
 * user's login-shell `export`s, so keys set only in the shell would be missing.
 *
 * Precedence: an existing `process.env` value ALWAYS wins. Values from the
 * `.env` file only fill keys that are not already set in the environment. This
 * keeps `export FOO=...` in the shell authoritative, with `.env` as the
 * persistent fallback.
 *
 * Call once at daemon startup, before `createDaemon()`.
 */
export async function loadBatonEnv(): Promise<{ loaded: number; skipped: number }> {
  const home = process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  const envPath = join(home, '.env');

  let raw: string;
  try {
    raw = await readFile(envPath, 'utf-8');
  } catch {
    // No .env file — nothing to load. This is normal on a fresh setup.
    return { loaded: 0, skipped: 0 };
  }

  let loaded = 0;
  let skipped = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // Skip blank lines and comments (# ...).
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      skipped++;
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      skipped++;
      continue;
    }

    let value = trimmed.slice(eq + 1).trim();
    // Strip a single pair of surrounding quotes: KEY="v" or KEY='v' → v.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // process.env wins — only fill keys that aren't already set.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    } else {
      skipped++;
    }
  }

  return { loaded, skipped };
}
