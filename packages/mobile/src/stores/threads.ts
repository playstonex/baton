import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AgentType } from '@baton/shared';

export interface RecentSession {
  id: string;
  title: string;
  project: string;
  updatedAt: string;
  status: 'active' | 'idle' | 'error';
  type: AgentType;
}

interface ThreadsState {
  sessions: RecentSession[];
  pinnedSessions: string[];
  searchQuery: string;
  groupByProject: boolean;
  isLoaded: boolean;
  loadSessions: () => Promise<void>;
  addSession: (session: RecentSession) => void;
  removeSession: (id: string) => void;
  togglePin: (id: string) => void;
  setSearchQuery: (q: string) => void;
  setGroupByProject: (v: boolean) => void;
}

const SESSIONS_KEY = 'fw_thread_sessions';
const PINNED_KEY = 'fw_pinned_sessions';

function persist(key: string, data: unknown) {
  SecureStore.setItemAsync(key, JSON.stringify(data)).catch(() => {});
}

export const useThreadsStore = create<ThreadsState>()((set, get) => ({
  sessions: [],
  pinnedSessions: [],
  searchQuery: '',
  groupByProject: true,
  isLoaded: false,

  loadSessions: async () => {
    try {
      const rawSessions = await SecureStore.getItemAsync(SESSIONS_KEY);
      if (rawSessions) set({ sessions: JSON.parse(rawSessions) });
    } catch { /* corrupt — start fresh */ }
    try {
      const rawPinned = await SecureStore.getItemAsync(PINNED_KEY);
      if (rawPinned) set({ pinnedSessions: JSON.parse(rawPinned) });
    } catch { /* corrupt — start fresh */ }
    set({ isLoaded: true });
  },

  addSession: (session) => {
    const filtered = get().sessions.filter((s) => s.id !== session.id);
    const sessions = [session, ...filtered].slice(0, 50);
    set({ sessions });
    persist(SESSIONS_KEY, sessions);
  },

  removeSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    const pinnedSessions = get().pinnedSessions.filter((pid) => pid !== id);
    set({ sessions, pinnedSessions });
    persist(SESSIONS_KEY, sessions);
    persist(PINNED_KEY, pinnedSessions);
  },

  togglePin: (id) => {
    const pinned = get().pinnedSessions;
    const pinnedSessions = pinned.includes(id)
      ? pinned.filter((pid) => pid !== id)
      : [...pinned, id];
    set({ pinnedSessions });
    persist(PINNED_KEY, pinnedSessions);
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setGroupByProject: (groupByProject) => set({ groupByProject }),
}));
