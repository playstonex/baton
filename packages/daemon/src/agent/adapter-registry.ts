// Open adapter registry (plugin stage 1). Built-in providers register here at
// module load; third-party providers register from $BATON_HOME/plugins at
// daemon startup (see plugins/loader.ts). createAdapter() resolves through
// this registry instead of a static map, so extensions need no core edits.

import type { BaseAgentAdapter } from './adapter.js';

export type AdapterConstructor = new () => BaseAgentAdapter;

export class AdapterRegistry {
  private readonly ctors = new Map<string, AdapterConstructor>();

  /** Register a provider; returns an unregister fn (used by tests). */
  register(type: string, ctor: AdapterConstructor): () => void {
    if (this.ctors.has(type)) {
      throw new Error(
        `Adapter type '${type}' already registered — refusing to silently replace it`,
      );
    }
    this.ctors.set(type, ctor);
    return () => {
      // Only remove if still our registration (a later duplicate would have
      // thrown anyway, so this is just defensive).
      if (this.ctors.get(type) === ctor) this.ctors.delete(type);
    };
  }

  create(type: string): BaseAgentAdapter | null {
    const Ctor = this.ctors.get(type);
    return Ctor ? new Ctor() : null;
  }

  has(type: string): boolean {
    return this.ctors.has(type);
  }

  ids(): string[] {
    return [...this.ctors.keys()];
  }
}

/** The singleton registry used by createAdapter() and the plugin loader. */
export const adapterRegistry = new AdapterRegistry();
