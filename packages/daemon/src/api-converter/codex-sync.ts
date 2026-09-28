import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify, type TomlPrimitive } from 'smol-toml';
import type { ApiProviderConfig } from '@baton/shared';

/**
 * Syncs Baton-managed API providers into the Codex CLI user config
 * (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`) as
 * `[model_providers.<id>]` sections.
 *
 * Only the `model_providers.*` table is managed — every other section in the
 * existing config.toml (mcp_servers, projects, features, …) is preserved
 * verbatim. A backup (`config.toml.baton.bak`) is written before each change.
 */

/** Provider ids Codex reserves; writing them would shadow built-ins. */
const RESERVED_PROVIDER_IDS = new Set(['openai', 'ollama', 'lmstudio']);

/** Default daemon HTTP port — matches DEFAULT_PORT in index.ts. */
const DEFAULT_DAEMON_PORT = 3210;

function getCodexHome(): string {
  return process.env.CODEX_HOME ?? `${process.env.HOME ?? '~'}/.codex`;
}

async function getConfigPath(): Promise<string> {
  const home = getCodexHome();
  await mkdir(home, { recursive: true });
  return join(home, 'config.toml');
}

type ModelProviderTable = {
  base_url: string;
  name?: string;
  env_key: string;
  wire_api: 'responses' | 'chat';
};

type CodexConfig = {
  model_providers?: Record<string, ModelProviderTable>;
} & Record<string, TomlPrimitive>;

/**
 * Build the `[model_providers.<id>]` table from a Baton provider config.
 *
 * In proxy mode, every provider is written to point at the local daemon
 * (`http://localhost:<port>/proxy`) with `wire_api = "responses"`. The daemon
 * then adapts the request to the provider's real upstream format. The real
 * upstream baseUrl + upstreamFormat live in Baton's config and are used by the
 * daemon at request time — Codex only needs to know "talk Responses to
 * localhost".
 *
 * Keys whose id is reserved are skipped (and reported).
 */
function buildModelProviders(
  config: ApiProviderConfig,
  port: number = DEFAULT_DAEMON_PORT,
): {
  table: Record<string, ModelProviderTable>;
  /** default provider id + its first model, to set top-level model_provider/model. */
  defaultSelection: { providerId: string; model: string } | null;
  skipped: string[];
} {
  const table: Record<string, ModelProviderTable> = {};
  const skipped: string[] = [];
  let defaultSelection: { providerId: string; model: string } | null = null;

  for (const [id, profile] of Object.entries(config.providers)) {
    if (RESERVED_PROVIDER_IDS.has(id)) {
      skipped.push(id);
      continue;
    }
    if (!profile.enabled) continue;

    table[id] = {
      base_url: `http://localhost:${port}/proxy`,
      name: id,
      env_key: profile.envKey,
      wire_api: 'responses',
    };

    // The default provider becomes Codex's active provider/model so the model
    // picker shows its models without the user having to wire up top-level
    // `model_provider` / `model` keys by hand.
    if (profile.isDefault && !defaultSelection && profile.models.length > 0) {
      defaultSelection = { providerId: id, model: profile.models[0] };
    }
  }

  return { table, defaultSelection, skipped };
}

/**
 * Serialize the providers that *would* be written, for UI preview.
 * Does not touch the filesystem.
 */
export function previewCodexProviders(config: ApiProviderConfig, port?: number): string {
  const { table, defaultSelection } = buildModelProviders(config, port);
  const root: Record<string, TomlPrimitive> = { model_providers: table };
  if (defaultSelection) {
    root.model_provider = defaultSelection.providerId;
    root.model = defaultSelection.model;
  }
  return stringify(root);
}

/**
 * Write Baton's enabled providers into Codex's config.toml, replacing the
 * entire `model_providers` table (ids removed in Baton are removed here too).
 * All other sections are preserved. Best-effort: errors are thrown to the
 * caller, which is expected to log and continue.
 */
export async function syncProvidersToCodex(
  config: ApiProviderConfig,
  port: number = DEFAULT_DAEMON_PORT,
): Promise<void> {
  const configPath = await getConfigPath();

  // Load existing config.toml (may not exist yet on a fresh machine).
  let existing: CodexConfig = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    existing = parse(raw) as CodexConfig;
  } catch {
    // Missing or unparseable — start from an empty document.
    existing = {};
  }

  // Rebuild the model_providers table entirely from Baton's source of truth.
  const { table, defaultSelection, skipped } = buildModelProviders(config, port);
  if (skipped.length > 0) {
    console.warn(
      `[baton] codex-sync: skipped reserved provider ids: ${skipped.join(', ')}`,
    );
  }

  existing.model_providers = table;

  // Point Codex's active model at the default provider so its model picker
  // actually offers the provider's models. Only overwrite when there's a
  // Baton-managed default; if the user removed the default, leave whatever
  // model/model_provider they had so we don't clobber a hand-set choice.
  if (defaultSelection) {
    existing.model_provider = defaultSelection.providerId;
    existing.model = defaultSelection.model;
  }

  // Back up the current file before overwriting (only if it existed).
  try {
    await copyFile(configPath, `${configPath}.baton.bak`);
  } catch {
    // No existing file to back up — fine.
  }

  await writeFile(configPath, stringify(existing as Record<string, TomlPrimitive>), 'utf-8');
}
