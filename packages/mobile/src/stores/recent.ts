import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { SavedConnection } from '../services/secure-storage';
import type { AgentType } from '@baton/shared';

export interface RecentConnection {
  mode: 'local' | 'remote';
  label: string;
  localHttpUrl?: string;
  localWsUrl?: string;
  relayUrl?: string;
  lastUsed: number;
}

export interface RecentSession {
  id: string;
  type: AgentType;
  projectPath: string;
  lastActivity: number;
  /** How this session should open: structured chat view or raw terminal.
   * Only meaningful for codex (the only agent with a chat mode). */
  chatMode?: 'chat' | 'terminal';
  /** Server-derived title (first user prompt) when the daemon provides one. */
  title?: string;
  /** Transcript event count from the daemon's session store, for the meta line. */
  eventCount?: number;
}

interface RecentState {
  connections: RecentConnection[];
  sessions: RecentSession[];
  addConnection: (config: SavedConnection) => void;
  removeConnection: (index: number) => void;
  loadRecent: () => Promise<void>;
  addSession: (session: RecentSession) => void;
  /** Merge server-backed sessions (from GET /api/sessions) into the local
   * history — the daemon's store is the source of truth; local entries act
   * as the offline fallback for ids the server no longer lists. */
  addSessions: (sessions: RecentSession[]) => void;
  removeSession: (id: string) => void;
}

const RECENT_CONNECTIONS_KEY = 'fw_recent_connections';
const RECENT_SESSIONS_KEY = 'fw_recent_sessions';

export const useRecentStore = create<RecentState>()((set, get) => ({
  connections: [],
  sessions: [],

  addConnection: (config) => {
    const label =
      config.mode === 'local' ? config.localHttpUrl || 'Local' : config.relayUrl || 'Remote';
    const filtered = get().connections.filter((c) => {
      if (config.mode === 'local') {
        return !(c.mode === 'local' && c.localHttpUrl === config.localHttpUrl);
      }
      return !(c.mode === 'remote' && c.relayUrl === config.relayUrl);
    });
    const entry: RecentConnection = {
      mode: config.mode,
      label,
      localHttpUrl: config.localHttpUrl,
      localWsUrl: config.localWsUrl,
      relayUrl: config.relayUrl,
      lastUsed: Date.now(),
    };
    const connections = [entry, ...filtered].slice(0, 10);
    set({ connections });
    SecureStore.setItemAsync(RECENT_CONNECTIONS_KEY, JSON.stringify(connections)).catch(() => {});
  },

  removeConnection: (index) => {
    const connections = get().connections.filter((_, i) => i !== index);
    set({ connections });
    SecureStore.setItemAsync(RECENT_CONNECTIONS_KEY, JSON.stringify(connections)).catch(() => {});
  },

  loadRecent: async () => {
    try {
      const rawConns = await SecureStore.getItemAsync(RECENT_CONNECTIONS_KEY);
      if (rawConns) set({ connections: JSON.parse(rawConns) });
    } catch {
      // corrupt — start fresh
    }
    try {
      const rawSess = await SecureStore.getItemAsync(RECENT_SESSIONS_KEY);
      if (rawSess) set({ sessions: JSON.parse(rawSess) });
    } catch {
      // corrupt — start fresh
    }
  },

  addSession: (session) => {
    const filtered = get().sessions.filter((s) => s.id !== session.id);
    const sessions = [session, ...filtered].slice(0, 20);
    set({ sessions });
    SecureStore.setItemAsync(RECENT_SESSIONS_KEY, JSON.stringify(sessions)).catch(() => {});
  },

  addSessions: (incoming) => {
    if (incoming.length === 0) return;
    const byId = new Map(get().sessions.map((s) => [s.id, s]));
    for (const session of incoming) {
      const existing = byId.get(session.id);
      // Server data wins on merge, but keep a locally-set chatMode when the
      // server row doesn't carry one.
      byId.set(session.id, { ...existing, ...session, chatMode: session.chatMode ?? existing?.chatMode });
    }
    const sessions = [...byId.values()]
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 50);
    set({ sessions });
    SecureStore.setItemAsync(RECENT_SESSIONS_KEY, JSON.stringify(sessions)).catch(() => {});
  },

  removeSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    set({ sessions });
    SecureStore.setItemAsync(RECENT_SESSIONS_KEY, JSON.stringify(sessions)).catch(() => {});
  },
}));
