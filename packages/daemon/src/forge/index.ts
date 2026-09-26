import type { ForgeRepoRef } from '@baton/shared';
import { ForgeRegistry } from './registry.js';
import { githubAdapter } from './github/service.js';

export * from './service.js';
export * from './registry.js';
export { GitHubForgeService, githubAdapter, defaultGhRunner } from './github/service.js';
export type { GhResult, GhRunner } from './github/service.js';

/** A registry pre-loaded with the built-in forge adapters (GitHub for now). */
export function createDefaultForgeRegistry(): ForgeRegistry {
  const registry = new ForgeRegistry();
  registry.register('github', githubAdapter());
  return registry;
}

/**
 * Parse an `owner/name` slug (optionally a full URL) into a ForgeRepoRef.
 * Returns null when the input cannot be parsed.
 */
export function parseRepoRef(input: string, defaultHost = 'github.com'): ForgeRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full URL form: https://host/owner/name(.git)
  const urlMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+)/);
  if (urlMatch) {
    const [, host, owner, name] = urlMatch;
    return { slug: `${owner}/${name}`, owner, name, host };
  }

  // scp-like SSH form: git@host:owner/name(.git)
  const sshMatch = trimmed.match(/^[^@]+@([^:]+):([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    const [, host, owner, name] = sshMatch;
    return { slug: `${owner}/${name}`, owner, name, host };
  }

  // Bare owner/name.
  const slugMatch = trimmed.match(/^([^/\s]+)\/([^/\s.]+)$/);
  if (slugMatch) {
    const [, owner, name] = slugMatch;
    return { slug: `${owner}/${name}`, owner, name, host: defaultHost };
  }

  return null;
}
