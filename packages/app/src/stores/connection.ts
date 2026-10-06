import { create } from 'zustand';
import type { AgentProcess, AgentStatus, StatusDetail } from '@baton/shared';

interface AgentState {
  agents: AgentProcess[];
  setAgents: (agents: AgentProcess[]) => void;
  updateAgentStatus: (id: string, status: AgentStatus, detail?: StatusDetail) => void;
  addAgent: (agent: AgentProcess) => void;
  removeAgent: (id: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  setAgents: (agents) => set({ agents }),
  updateAgentStatus: (id, status, detail) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, status, stateDetail: detail } : a,
      ),
    })),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
  removeAgent: (id) => set((state) => ({ agents: state.agents.filter((a) => a.id !== id) })),
}));
