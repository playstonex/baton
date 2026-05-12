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

export class PushNotificationService {
  private subscriptions = new Map<string, PushSubscription>();

  register(clientId: string, token: string, platform: 'ios' | 'android' | 'web'): void {
    this.subscriptions.set(clientId, { clientId, token, platform });
  }

  unregister(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  async notify(clientId: string, payload: NotificationPayload): Promise<boolean> {
    const sub = this.subscriptions.get(clientId);
    if (!sub) return false;

    switch (sub.platform) {
      case 'web':
        return this.notifyWebPush(sub.token, payload);
      case 'ios':
      case 'android':
        return this.notifyMobilePush(sub.token, sub.platform, payload);
    }
  }

  broadcast(payload: NotificationPayload): void {
    for (const sub of this.subscriptions.values()) {
      this.notify(sub.clientId, payload).catch(() => {});
    }
  }

  private async notifyWebPush(_endpoint: string, _payload: NotificationPayload): Promise<boolean> {
    return false;
  }

  private async notifyMobilePush(
    _token: string,
    _platform: 'ios' | 'android',
    _payload: NotificationPayload,
  ): Promise<boolean> {
    return false;
  }

  shouldNotify(eventType: string): boolean {
    const notifyTypes = new Set([
      'permission_request',
      'error',
      'status_change',
    ]);
    return notifyTypes.has(eventType);
  }

  listSubscriptions(): PushSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}
