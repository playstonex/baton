import { describe, it, expect, beforeEach } from 'bun:test';
import { AdapterRegistry } from '../agent/adapter-registry.js';
import type { BaseAgentAdapter } from '../agent/adapter.js';

class StubAdapter {
  // Minimal stand-in; create() only needs a constructible class.
  constructor() {}
}
void (StubAdapter as unknown as { _brand?: BaseAgentAdapter });

describe('AdapterRegistry', () => {
  let reg: AdapterRegistry;

  beforeEach(() => {
    reg = new AdapterRegistry();
  });

  it('registers and creates by type', () => {
    reg.register('echo', StubAdapter as never);
    expect(reg.has('echo')).toBe(true);
    expect(reg.create('echo')).toBeInstanceOf(StubAdapter);
  });

  it('returns null for unknown types', () => {
    expect(reg.create('nope')).toBeNull();
    expect(reg.has('nope')).toBe(false);
  });

  it('rejects duplicate registrations instead of silently replacing', () => {
    reg.register('echo', StubAdapter as never);
    expect(() => reg.register('echo', StubAdapter as never)).toThrow(/already registered/);
  });

  it('unregister fn removes only its own registration', () => {
    const off = reg.register('echo', StubAdapter as never);
    off();
    expect(reg.has('echo')).toBe(false);
  });

  it('ids() lists registered types', () => {
    reg.register('a', StubAdapter as never);
    reg.register('b', StubAdapter as never);
    expect(reg.ids().sort()).toEqual(['a', 'b']);
  });
});
