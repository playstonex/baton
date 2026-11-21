import { create } from 'zustand';

interface LayoutState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  sidebarPinned: true,
  setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
}));
