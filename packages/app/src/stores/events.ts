import { create } from 'zustand';
import type { ParsedEvent } from '@flowwhips/shared';

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
      return {
        events,
        fileChanges: events.filter((e) => e.type === 'file_change'),
        toolUses: events.filter((e) => e.type === 'tool_use'),
      };
    }),
  clearEvents: () => set({ events: [], fileChanges: [], toolUses: [] }),
}));
