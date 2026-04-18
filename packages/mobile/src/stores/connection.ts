import { create } from 'zustand';
import type { SavedConnection } from '../services/secure-storage';

interface ConnectionState {
  mode: 'local' | 'remote';
  connected: boolean;
  relayUrl: string;
  hostId: string;
  token: string;
  localHttpUrl: string;
  localWsUrl: string;
  setMode: (mode: 'local' | 'remote') => void;
  setConnected: (connected: boolean) => void;
  setCredentials: (config: SavedConnection) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  mode: 'local',
  connected: false,
  relayUrl: '',
  hostId: '',
  token: '',
  localHttpUrl: '',
  localWsUrl: '',
  setMode: (mode) => set({ mode }),
  setConnected: (connected) => set((state) => (state.connected === connected ? state : { connected })),
  setCredentials: (config) =>
    set({
      mode: config.mode,
      connected: false,
      relayUrl: config.relayUrl ?? '',
      hostId: config.hostId ?? '',
      token: config.token ?? '',
      localHttpUrl: config.localHttpUrl ?? '',
      localWsUrl: config.localWsUrl ?? '',
    }),
}));
