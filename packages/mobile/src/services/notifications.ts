import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { wsService } from './websocket';

// Configure notification handler for foreground notifications.
// Registered once at module load — safe because setNotificationHandler is idempotent.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type SessionNavHandler = (sessionId: string) => void;

class NotificationService {
  private expoPushToken: string | null = null;
  private listenersRegistered = false;

  /** Subscribers notified when a notification tap carries a sessionId. */
  private sessionNavHandlers = new Set<SessionNavHandler>();

  /**
   * Subscribe to session-navigation events (notification tap with sessionId).
   * The layout wires this to router.navigate. Returns an unsubscribe fn.
   */
  onSessionNavigation(handler: SessionNavHandler): () => void {
    this.sessionNavHandlers.add(handler);
    return () => {
      this.sessionNavHandlers.delete(handler);
    };
  }

  /**
   * Request permission and obtain an Expo push token. Idempotent — returns
   * the cached token on repeat calls. Listeners are registered once.
   */
  async initialize(): Promise<string | null> {
    if (this.expoPushToken) return this.expoPushToken;
    this.ensureListeners();

    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('[Push] Notification permission not granted');
      return null;
    }

    try {
      // getExpoPushTokenAsync needs the EAS project UUID (app.json →
      // extra.eas.projectId), NOT the bundle identifier.
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) {
        console.log('[Push] No EAS projectId configured; skipping push registration');
        return null;
      }
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      this.expoPushToken = token.data;
      console.log(`[Push] Expo push token: ${this.expoPushToken?.slice(0, 20)}...`);
      return this.expoPushToken;
    } catch (err) {
      console.log('[Push] Failed to get push token:', err);
      return null;
    }
  }

  /**
   * Register the current push token with the daemon over the active WS.
   * Safe to call on every reconnect — the daemon maps tokens by clientId,
   * which changes per connection, so re-registration is required.
   */
  registerWithDaemon(): void {
    if (!this.expoPushToken) return;
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    wsService.send({
      type: 'control',
      action: 'register_push_token',
      payload: { token: this.expoPushToken, platform },
    });
  }

  getToken(): string | null {
    return this.expoPushToken;
  }

  unregister(): void {
    if (!this.expoPushToken) return;
    wsService.send({ type: 'control', action: 'unregister_push_token' });
  }

  /**
   * Register the notification response + foreground listeners exactly once.
   * Moved out of initialize() so repeated init calls don't stack duplicate
   * listeners (a classic expo-notifications leak).
   */
  private ensureListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Push] Foreground notification:', notification.request.content.title);
    });

    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const sessionId =
        data && typeof data === 'object' && 'sessionId' in data
          ? (data as { sessionId: unknown }).sessionId
          : undefined;
      if (typeof sessionId === 'string' && sessionId) {
        console.log('[Push] Tapped notification for session:', sessionId);
        for (const h of this.sessionNavHandlers) h(sessionId);
      }
    });
  }
}

export const notificationService = new NotificationService();
