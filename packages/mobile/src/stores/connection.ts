import { create } from 'zustand';
import type { HostProfile, SavedConnection } from '../services/secure-storage';

interface ConnectionState {
  // ── Active connection (derived from active host, for legacy consumers) ──
  mode: 'local' | 'remote';
  connected: boolean;
  relayUrl: string;
  hostId: string;
  token: string;
  localHttpUrl: string;
  localWsUrl: string;

  // ── Multi-host ──────────────────────────────────────────────────────────
  hosts: HostProfile[];
  activeHostId: string | null;

  // ── Actions ─────────────────────────────────────────────────────────────
  setMode: (mode: 'local' | 'remote') => void;
  setConnected: (connected: boolean) => void;

  /** Update the active connection fields (legacy shim — maps onto active host). */
  setCredentials: (config: SavedConnection) => void;

  /** Replace the whole host list (e.g. after loading from storage). */
  setHosts: (hosts: HostProfile[]) => void;

  /** Mark a host active. Does NOT reconnect — caller does wsService.configure + connect. */
  setActiveHost: (hostId: string) => void;

  /** Add a new host (or update a dup by identity) and make it active. */
  addHost: (host: HostProfile) => void;

  /** Remove a host by id. If it was active, clears active fields. */
  removeHost: (hostId: string) => void;
}

function connectionFromHost(h: HostProfile | undefined | null) {
  if (!h) {
    return {
      mode: 'local' as const,
      relayUrl: '',
      hostId: '',
      token: '',
      localHttpUrl: '',
      localWsUrl: '',
    };
  }
  return {
    mode: h.mode,
    relayUrl: h.relayUrl ?? '',
    hostId: h.hostId ?? '',
    token: h.token ?? '',
    localHttpUrl: h.localHttpUrl ?? '',
    localWsUrl: h.localWsUrl ?? '',
  };
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  mode: 'local',
  connected: false,
  relayUrl: '',
  hostId: '',
  token: '',
  localHttpUrl: '',
  localWsUrl: '',
  hosts: [],
  activeHostId: null,

  setMode: (mode) => set({ mode }),

  setConnected: (connected) =>
    set((state) => (state.connected === connected ? state : { connected })),

  setCredentials: (config) => {
    // Legacy shim: update the active host's connection fields in place.
    const { hosts, activeHostId } = get();
    const updated = hosts.map((h) =>
      h.id === activeHostId
        ? {
            ...h,
            mode: config.mode,
            relayUrl: config.relayUrl,
            hostId: config.hostId,
            token: config.token,
            localHttpUrl: config.localHttpUrl,
            localWsUrl: config.localWsUrl,
            lastUsed: Date.now(),
          }
        : h,
    );
    set({
      mode: config.mode,
      relayUrl: config.relayUrl ?? '',
      hostId: config.hostId ?? '',
      token: config.token ?? '',
      localHttpUrl: config.localHttpUrl ?? '',
      localWsUrl: config.localWsUrl ?? '',
      hosts: updated,
      connected: false,
    });
  },

  setHosts: (hosts) => {
    const activeId = get().activeHostId;
    const active = hosts.find((h) => h.id === activeId) ?? hosts[0] ?? null;
    set({
      hosts,
      activeHostId: active?.id ?? null,
      ...connectionFromHost(active),
    });
  },

  setActiveHost: (hostId) => {
    const host = get().hosts.find((h) => h.id === hostId) ?? null;
    set({
      activeHostId: hostId,
      connected: false,
      ...connectionFromHost(host),
    });
  },

  addHost: (host) => {
    const existing = get().hosts.findIndex((h) => h.id === host.id);
    const hosts =
      existing >= 0
        ? get().hosts.map((h) => (h.id === host.id ? host : h))
        : [host, ...get().hosts];
    set({
      hosts,
      activeHostId: host.id,
      ...connectionFromHost(host),
      connected: false,
    });
  },

  removeHost: (hostId) => {
    const hosts = get().hosts.filter((h) => h.id !== hostId);
    const wasActive = get().activeHostId === hostId;
    const nextActive = wasActive ? (hosts[0] ?? null) : null;
    set({
      hosts,
      activeHostId: wasActive ? (nextActive?.id ?? null) : get().activeHostId,
      ...(wasActive ? connectionFromHost(nextActive) : {}),
      ...(wasActive ? { connected: false } : {}),
    });
  },
}));
