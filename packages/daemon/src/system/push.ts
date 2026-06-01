import type { AccessMode } from '@baton/shared';

interface PushSubscription {
  clientId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
}

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// Events that trigger notifications in on-request mode
const ON_REQUEST_EVENT_TYPES = new Set(['permission_request', 'error']);

// Events that trigger notifications in full-access mode (everything meaningful)
const FULL_ACCESS_EVENT_TYPES = new Set(['permission_request', 'error', 'status_change']);

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export class PushNotificationService {
  private subscriptions = new Map<string, PushSubscription>();
  private accessMode: AccessMode = 'on-request';

  register(clientId: string, token: string, platform: 'ios' | 'android' | 'web'): void {
    this.subscriptions.set(clientId, { clientId, token, platform });
  }

  unregister(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  setAccessMode(mode: AccessMode): void {
    this.accessMode = mode;
  }

  async notify(clientId: string, payload: NotificationPayload): Promise<boolean> {
    const sub = this.subscriptions.get(clientId);
    if (!sub) return false;

    if (sub.platform === 'web') {
      return this.notifyWebPush(sub.token, payload);
    }
    return this.notifyMobilePush(sub.token, sub.platform, payload);
  }

  broadcast(payload: NotificationPayload): void {
    for (const sub of this.subscriptions.values()) {
      this.notify(sub.clientId, payload).catch(() => {});
    }
  }

  private async notifyWebPush(endpoint: string, payload: NotificationPayload): Promise<boolean> {
    // Web Push requires VAPID keys — stub for now, returns true to avoid retry spam
    console.log(`[Push] Web push to ${endpoint.slice(0, 30)}...: ${payload.title}`);
    return true;
  }

  private async notifyMobilePush(
    token: string,
    _platform: 'ios' | 'android',
    payload: NotificationPayload,
  ): Promise<boolean> {
    // Expo Push Service — works for both iOS and Android with Expo-managed apps
    const message = {
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: 'default' as const,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(message),
        });

        const data = (await res.json()) as {
          data?: { status: string; id?: string; message?: string }[];
          errors?: { message: string }[];
        };

        if (data.errors && data.errors.length > 0) {
          console.error(`[Push] Expo push error:`, data.errors[0]?.message);
          return false;
        }

        if (data.data && data.data.length > 0) {
          const ticket = data.data[0];
          if (!ticket) continue;

          if (ticket.status === 'ok') {
            return true;
          }

          // Handle device not registered — auto-cleanup
          if (ticket.message?.includes('DeviceNotRegistered')) {
            console.log(`[Push] Device not registered, removing token: ${token.slice(0, 20)}...`);
            this.removeByToken(token);
            return false;
          }

          console.error(`[Push] Ticket error: ${ticket.message}`);
          return false;
        }

        return true;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        console.error(`[Push] Failed after ${MAX_RETRIES + 1} attempts:`, err);
        return false;
      }
    }

    return false;
  }

  private removeByToken(token: string): void {
    for (const [clientId, sub] of this.subscriptions.entries()) {
      if (sub.token === token) {
        this.subscriptions.delete(clientId);
        break;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  shouldNotify(eventType: string): boolean {
    if (this.accessMode === 'full-access') {
      return FULL_ACCESS_EVENT_TYPES.has(eventType);
    }
    return ON_REQUEST_EVENT_TYPES.has(eventType);
  }

  listSubscriptions(): PushSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}
