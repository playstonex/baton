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
    set((state) => ({
      events: [...state.events, event].slice(-2000),
      // Incremental derived lists: a non-matching event costs O(1) instead
      // of re-filtering the whole 2000-entry log.
      fileChanges:
        event.type === 'file_change'
          ? [...state.fileChanges, event].slice(-500)
          : state.fileChanges,
      toolUses:
        event.type === 'tool_use'
          ? [...state.toolUses, event].slice(-500)
          : state.toolUses,
    })),
  clearEvents: () => set({ events: [], fileChanges: [], toolUses: [] }),
}));
