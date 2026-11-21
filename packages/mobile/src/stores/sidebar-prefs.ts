import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { SESSION_GROUP_MODES, type SessionGroupMode } from '@baton/shared/utils';

interface SidebarPrefsState {
  groupMode: SessionGroupMode;
  loaded: boolean;
  load: () => Promise<void>;
  setGroupMode: (mode: SessionGroupMode) => void;
}

const KEY = 'fw_sidebar_group_mode';

export const useSidebarPrefs = create<SidebarPrefsState>()((set, get) => ({
  groupMode: 'project',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw && (SESSION_GROUP_MODES as readonly string[]).includes(raw)) {
        set({ groupMode: raw as SessionGroupMode });
      }
    } catch {
      // unreadable — keep the default
    }
    set({ loaded: true });
  },

  setGroupMode: (groupMode) => {
    set({ groupMode });
    void SecureStore.setItemAsync(KEY, groupMode).catch(() => {});
  },
}));
