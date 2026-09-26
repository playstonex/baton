import type { ForgeService } from './service.js';

export interface ForgeAdapterRegistration {
  /** Factory for the service. Called lazily by {@link ForgeRegistry.create}. */
  createService: () => ForgeService;
  /**
   * Synchronous host match, e.g. host === 'github.com'. Used first; when more
   * than one adapter claims a host the match is treated as ambiguous.
   */
  matchesHost?: (host: string) => boolean;
  /**
   * Async host probe for hosts that cannot be matched by name (self-hosted
   * GHE / GitLab / Gitea). MUST resolve false (not throw) when the host is not
   * this forge — the registry runs every probe under Promise.allSettled, so a
   * thrown rejection only means "not me" and never crashes the shared resolve.
   */
  probeHost?: (host: string) => Promise<boolean>;
}

/**
 * Open registry of forge adapters, mirroring paseo's ForgeRegistry design.
 * Resolution order for a host: exact synchronous match first (ambiguity -> null),
 * then async probing.
 */
export class ForgeRegistry {
  private readonly adapters = new Map<string, ForgeAdapterRegistration>();

  /** Register an adapter under a forge kind. Returns an unregister fn. */
  register(forge: string, adapter: ForgeAdapterRegistration): () => void {
    this.adapters.set(forge, adapter);
    return () => {
      // Only remove if it is still the same registration we added.
      if (this.adapters.get(forge) === adapter) {
        this.adapters.delete(forge);
      }
    };
  }

  /** All registered forge kinds. */
  list(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Synchronous host match. Returns the forge kind, or null when no adapter
   * matches OR more than one matches (ambiguous — the caller should probe or
   * ask the user rather than guess).
   */
  matchHost(host: string): string | null {
    const hits: string[] = [];
    for (const [forge, adapter] of this.adapters) {
      if (adapter.matchesHost?.(host)) hits.push(forge);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * Async host probe across every adapter that exposes probeHost. Uses
   * Promise.allSettled so one adapter's thrown/rejected probe cannot break the
   * others. Returns the single forge kind that claimed the host, or null when
   * none or more than one did.
   */
  async probeHost(host: string): Promise<string | null> {
    const probes = [...this.adapters.entries()].filter(([, a]) => a.probeHost);
    const results = await Promise.allSettled(probes.map(([, a]) => a.probeHost!(host)));

    const hits: string[] = [];
    results.forEach((res, i) => {
      if (res.status === 'fulfilled' && res.value === true) {
        hits.push(probes[i][0]);
      }
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * Resolve a host to a forge kind: synchronous match first, then probe.
   */
  async resolveHost(host: string): Promise<string | null> {
    const matched = this.matchHost(host);
    if (matched) return matched;
    return this.probeHost(host);
  }

  /** Instantiate the service for a forge kind, or null when unregistered. */
  create(forge: string): ForgeService | null {
    return this.adapters.get(forge)?.createService() ?? null;
  }
}
