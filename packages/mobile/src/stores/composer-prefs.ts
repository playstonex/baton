import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type ThinkingPrefMode = 'none' | 'auto' | 'level';
export type ThinkingPrefLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingPref {
  mode: ThinkingPrefMode;
  level?: ThinkingPrefLevel;
}

/**
 * Per-session composer preferences and drafts, persisted across app restarts
 * so a model pick or a half-typed prompt survives leaving the chat — paseo
 * (draft store) and remodex (TurnComposerLocalDraft) both keep these.
 */
interface ComposerPrefsState {
  /** sessionId → model the user picked for this session. */
  models: Record<string, string>;
  /** sessionId → thinking mode/level. */
  thinking: Record<string, ThinkingPref>;
  /** sessionId → unsent composer text. */
  drafts: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  setModel: (sessionId: string, model: string) => void;
  setThinking: (sessionId: string, pref: ThinkingPref) => void;
  setDraft: (sessionId: string, text: string) => void;
}

const KEY = 'fw_composer_prefs';
const DRAFT_PERSIST_DEBOUNCE_MS = 600;

function persist(state: ComposerPrefsState): void {
  const { models, thinking, drafts } = state;
  void SecureStore.setItemAsync(KEY, JSON.stringify({ models, thinking, drafts })).catch(() => {});
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;

export const useComposerPrefs = create<ComposerPrefsState>()((set, get) => ({
  models: {},
  thinking: {},
  drafts: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          models?: Record<string, string>;
          thinking?: Record<string, ThinkingPref>;
          drafts?: Record<string, string>;
        };
        set({
          models: parsed.models ?? {},
          thinking: parsed.thinking ?? {},
          drafts: parsed.drafts ?? {},
          loaded: true,
        });
        return;
      }
    } catch {
      // first run or storage unavailable — defaults are fine
    }
    set({ loaded: true });
  },

  setModel: (sessionId, model) => {
    set((s) => ({ models: { ...s.models, [sessionId]: model } }));
    persist(get());
  },

  setThinking: (sessionId, pref) => {
    set((s) => ({ thinking: { ...s.thinking, [sessionId]: pref } }));
    persist(get());
  },

  setDraft: (sessionId, text) => {
    // In-memory immediately (session switches must not resurrect stale text),
    // keychain write debounced — keystrokes must not hit SecureStore directly.
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: text } }));
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      persist(get());
    }, DRAFT_PERSIST_DEBOUNCE_MS);
  },
}));
