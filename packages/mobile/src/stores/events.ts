import { create } from 'zustand';
import type { ParsedEvent } from '@baton/shared';

interface EventsState {
  events: ParsedEvent[];
  fileChanges: ParsedEvent[];
  toolUses: ParsedEvent[];
  addEvent: (event: ParsedEvent) => void;
  clearEvents: () => void;
}

export const useEventsStore = create<EventsState>()((set) => ({
  events: [],
  fileChanges: [],
  toolUses: [],
  addEvent: (event) =>
    set((state) => {
      const events = [...state.events, event].slice(-2000);
      const extra: Partial<EventsState> = {};
      if (event.type === 'file_change') {
        extra.fileChanges = [...state.fileChanges, event].slice(-500);
      }
      if (event.type === 'tool_use') {
        extra.toolUses = [...state.toolUses, event].slice(-500);
      }
      return { events, ...extra };
    }),
  clearEvents: () => set({ events: [], fileChanges: [], toolUses: [] }),
}));
