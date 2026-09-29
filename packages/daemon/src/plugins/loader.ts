// Third-party provider plugin loader (plugin stage 1).
//
// Convention: $BATON_HOME/plugins/<name>/ holds `plugin.json` + compiled JS.
// The manifest declares `kind: "provider"`, the adapter `type` it registers,
// and the `entry` module exporting `export default class extends BaseAgentAdapter`.
//
// Security boundary: plugins run IN the daemon process and are only loaded
// from this local directory the user explicitly manages — never downloaded
// or installed automatically ("never install without being asked").

import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  adapterRegistry,
  AdapterRegistry,
  type AdapterConstructor,
} from '../agent/adapter-registry.js';

export interface ProviderPluginManifest {
  name: string;
  kind: 'provider';
  /** Adapter type this provider registers under (spawnable AgentType). */
  type: string;
  /** Entry module relative to the plugin dir, e.g. "index.js". */
  entry: string;
  version?: string;
}

export interface LoadedPlugin {
  name: string;
  type: string;
  version?: string;
}

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  failed: Array<{ name: string; reason: string }>;
}

function pluginDir(): string {
  const home = process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  return join(home, 'plugins');
}

function isManifest(value: unknown): value is ProviderPluginManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<ProviderPluginManifest>;
  return (
    typeof m.name === 'string' &&
    typeof m.type === 'string' &&
    typeof m.entry === 'string' &&
    m.kind === 'provider' &&
    // Reject weird type strings before they reach the registry.
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(m.type)
  );
}

/**
 * Scan the plugin dir and register every valid provider plugin.
 * A broken plugin is reported and skipped — it must never keep the daemon
 * (or its built-in providers) from starting.
 *
 * @param dir plugin root (defaults to $BATON_HOME/plugins)
 * @param registry target registry (defaults to the shared singleton; tests
 *   pass an isolated instance so loaded types never leak between suites)
 */
export async function loadProviderPlugins(
  dir = pluginDir(),
  registry: AdapterRegistry = adapterRegistry,
): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { loaded: [], failed: [] };

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result; // no plugins dir — normal fresh install
  }

  for (const entry of entries) {
    // A plugin dir may itself be a symlink (e.g. a shared dotfiles setup) —
    // stat() follows links so those load like regular dirs; a symlink to a
    // non-directory falls through and is ignored.
    const pluginRoot = join(dir, entry.name);
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const st = await stat(pluginRoot).catch(() => null);
    if (!st?.isDirectory()) continue;
    const name = entry.name;
    try {
      const raw = await readFile(join(pluginRoot, 'plugin.json'), 'utf-8');
      const manifest: unknown = JSON.parse(raw);
      if (!isManifest(manifest)) {
        result.failed.push({ name, reason: 'invalid plugin.json manifest' });
        continue;
      }
      if (registry.has(manifest.type)) {
        result.failed.push({
          name,
          reason: `adapter type '${manifest.type}' already registered`,
        });
        continue;
      }

      // The entry must stay INSIDE the plugin dir — a manifest pointing at
      // ../../outside.js violates the contract and is rejected outright.
      const entryPath = resolve(pluginRoot, manifest.entry);
      if (!entryPath.startsWith(pluginRoot + sep)) {
        result.failed.push({ name, reason: 'entry escapes the plugin directory' });
        continue;
      }
      const entryUrl = pathToFileURL(entryPath).href;
      const mod = (await import(entryUrl)) as {
        default?: AdapterConstructor | { adapter: AdapterConstructor };
      };
      // Accept `export default class` or `export default { adapter: class }`.
      const ctor = typeof mod.default === 'function' ? mod.default : mod.default?.adapter;
      if (typeof ctor !== 'function') {
        result.failed.push({ name, reason: 'entry has no default adapter export' });
        continue;
      }

      registry.register(manifest.type, ctor as AdapterConstructor);
      result.loaded.push({ name, type: manifest.type, version: manifest.version });
    } catch (err) {
      result.failed.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
