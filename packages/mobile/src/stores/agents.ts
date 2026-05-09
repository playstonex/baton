import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AgentProcess, AgentStatus } from '@baton/shared';

const AGENTS_KEY = 'fw_agents';

interface AgentState {
  agents: AgentProcess[];
  setAgents: (agents: AgentProcess[]) => void;
  updateAgentStatus: (id: string, status: AgentStatus) => void;
  addAgent: (agent: AgentProcess) => void;
  removeAgent: (id: string) => void;
  loadAgents: () => Promise<void>;
}

function persistAgents(agents: AgentProcess[]) {
  const active = agents.filter((a) => a.status !== 'stopped');
  SecureStore.setItemAsync(AGENTS_KEY, JSON.stringify(active)).catch(() => {});
}

export const useAgentStore = create<AgentState>()((set) => ({
  agents: [],
  setAgents: (agents) => {
    set({ agents });
    persistAgents(agents);
  },
  updateAgentStatus: (id, status) =>
    set((state) => {
      const agents = state.agents.map((a) => (a.id === id ? { ...a, status } : a));
      persistAgents(agents);
      return { agents };
    }),
  addAgent: (agent) =>
    set((state) => {
      const agents = [...state.agents, agent];
      persistAgents(agents);
      return { agents };
    }),
  removeAgent: (id) =>
    set((state) => {
      const agents = state.agents.filter((a) => a.id !== id);
      persistAgents(agents);
      return { agents };
    }),
  loadAgents: async () => {
    try {
      const raw = await SecureStore.getItemAsync(AGENTS_KEY);
      if (raw) {
        const agents: AgentProcess[] = JSON.parse(raw);
        set({ agents });
      }
    } catch {
      // corrupt data — start fresh
    }
  },
}));
