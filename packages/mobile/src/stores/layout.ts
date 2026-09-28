import { create } from 'zustand';

interface LayoutState {
  tabBarHeight: number;
  setTabBarHeight: (height: number) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  tabBarHeight: 0,
  setTabBarHeight: (tabBarHeight) => set({ tabBarHeight }),
}));
