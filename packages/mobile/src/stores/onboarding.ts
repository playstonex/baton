import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const ONBOARDING_KEY = 'fw_onboarding_completed';
const STEP_KEY = 'fw_onboarding_step';

interface OnboardingState {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  isLoaded: boolean;
  loadOnboarding: () => Promise<void>;
  completeStep: (step: number) => void;
  markOnboardingComplete: () => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  hasCompletedOnboarding: false,
  currentStep: 0,
  isLoaded: false,

  loadOnboarding: async () => {
    try {
      const done = await SecureStore.getItemAsync(ONBOARDING_KEY);
      if (done === 'true') set({ hasCompletedOnboarding: true });
    } catch { /* ignore */ }
    try {
      const raw = await SecureStore.getItemAsync(STEP_KEY);
      if (raw) {
        const step = parseInt(raw, 10);
        if (!isNaN(step)) set({ currentStep: step });
      }
    } catch { /* ignore */ }
    set({ isLoaded: true });
  },

  completeStep: (step) => {
    set({ currentStep: step });
    SecureStore.setItemAsync(STEP_KEY, String(step)).catch(() => {});
  },

  markOnboardingComplete: () => {
    set({ hasCompletedOnboarding: true, currentStep: 5 });
    SecureStore.setItemAsync(ONBOARDING_KEY, 'true').catch(() => {});
    SecureStore.setItemAsync(STEP_KEY, '5').catch(() => {});
  },

  resetOnboarding: () => {
    set({ hasCompletedOnboarding: false, currentStep: 0 });
    SecureStore.setItemAsync(ONBOARDING_KEY, 'false').catch(() => {});
    SecureStore.setItemAsync(STEP_KEY, '0').catch(() => {});
  },
}));
