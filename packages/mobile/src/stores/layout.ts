import { create } from 'zustand';

interface LayoutState {
  tabBarHeight: number;
  setTabBarHeight: (height: number) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  tabBarHeight: 0,
  setTabBarHeight: (tabBarHeight) => set({ tabBarHeight }),
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  sidebarPinned: true,
  setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
}));
