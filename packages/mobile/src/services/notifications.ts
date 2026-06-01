import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { wsService } from './websocket';

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

class NotificationService {
  private expoPushToken: string | null = null;

  async initialize(): Promise<string | null> {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('[Push] Notification permission not granted');
      return null;
    }

    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: 'com.playstone.baton',
      });
      this.expoPushToken = token.data;
      console.log(`[Push] Expo push token: ${this.expoPushToken?.slice(0, 20)}...`);

      // Register token with daemon via WS
      this.registerWithDaemon();

      // Listen for foreground notifications
      Notifications.addNotificationReceivedListener((notification) => {
        console.log('[Push] Foreground notification:', notification.request.content.title);
      });

      // Listen for notification tap
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        if (data && typeof data === 'object' && 'sessionId' in data) {
          // Navigate to the session — handled by app-level listener
          console.log('[Push] Tapped notification for session:', (data as { sessionId: string }).sessionId);
        }
      });

      return this.expoPushToken;
    } catch (err) {
      console.log('[Push] Failed to get push token:', err);
      return null;
    }
  }

  private registerWithDaemon(): void {
    if (!this.expoPushToken) return;

    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    wsService.send({
      type: 'control',
      action: 'register_push_token',
      payload: {
        token: this.expoPushToken,
        platform,
      },
    });
  }

  getToken(): string | null {
    return this.expoPushToken;
  }

  unregister(): void {
    if (!this.expoPushToken) return;
    wsService.send({
      type: 'control',
      action: 'unregister_push_token',
    });
    this.expoPushToken = null;
  }
}

export const notificationService = new NotificationService();
