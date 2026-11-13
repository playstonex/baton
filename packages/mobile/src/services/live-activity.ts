import { NativeModules, Platform } from 'react-native';
import type { ActivitySummary } from '../components/messages/activitySummary';

const { BatonLiveActivityModule } = NativeModules;

export interface LiveActivityState {
  title: string;
  verb: string;
  target: string;
  status: 'running' | 'waiting_input' | 'completed' | 'error';
  durationMs: number;
  fileChangesCount: number;
}

export const liveActivityService = {
  isSupported(): boolean {
    return Platform.OS === 'ios' && !!BatonLiveActivityModule;
  },

  async start(
    sessionTitle: string,
    sessionId: string,
    summary: ActivitySummary,
  ): Promise<string | null> {
    if (!this.isSupported()) return null;
    try {
      const state: LiveActivityState = {
        title: summary.title,
        verb: summary.isActive ? 'Working' : summary.hasError ? 'Error' : 'Done',
        target: summary.pills.join(', '),
        status: summary.isActive ? 'running' : summary.hasError ? 'error' : 'completed',
        durationMs: summary.durationMs,
        fileChangesCount: summary.fileChangesCount,
      };
      return await BatonLiveActivityModule.startLiveActivity(sessionTitle, sessionId, state);
    } catch {
      return null;
    }
  },

  async update(
    summary: ActivitySummary,
    statusOverride?: 'running' | 'waiting_input' | 'completed' | 'error',
  ): Promise<void> {
    if (!this.isSupported()) return;
    try {
      const state: LiveActivityState = {
        title: summary.title,
        verb:
          statusOverride === 'waiting_input'
            ? 'Waiting'
            : summary.isActive
              ? 'Working'
              : summary.hasError
                ? 'Error'
                : 'Done',
        target: summary.pills.join(', '),
        status:
          statusOverride ??
          (summary.isActive ? 'running' : summary.hasError ? 'error' : 'completed'),
        durationMs: summary.durationMs,
        fileChangesCount: summary.fileChangesCount,
      };
      await BatonLiveActivityModule.updateLiveActivity(state);
    } catch {
      // Soft-fail: live activity updates should never interrupt UI
    }
  },

  async end(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await BatonLiveActivityModule.endLiveActivity();
    } catch {
      // Soft-fail
    }
  },
};
