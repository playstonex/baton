type NotificationType = 'agent_completed' | 'agent_error' | 'agent_waiting_input' | 'file_change';

interface PushNotification {
  type: NotificationType;
  title: string;
  body: string;
  sessionId: string;
  timestamp: number;
}

type NotificationHandler = (notification: PushNotification) => void;

class NotificationService {
  private handlers: Set<NotificationHandler> = new Set();
  private permission: NotificationPermission = 'default';

  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    this.permission = result;
    return result === 'granted';
  }

  onNotification(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  notify(notification: Omit<PushNotification, 'timestamp'>): void {
    const full: PushNotification = { ...notification, timestamp: Date.now() };

    for (const handler of this.handlers) {
      handler(full);
    }

    if (typeof window !== 'undefined' && this.permission === 'granted') {
      new window.Notification(full.title, { body: full.body, tag: full.sessionId });
    }
  }

  notifyAgentCompleted(sessionId: string, agentType: string): void {
    this.notify({ type: 'agent_completed', title: 'Agent Completed', body: `${agentType} session finished`, sessionId });
  }

  notifyAgentError(sessionId: string, error: string): void {
    this.notify({ type: 'agent_error', title: 'Agent Error', body: error.slice(0, 100), sessionId });
  }

  notifyAgentWaitingInput(sessionId: string): void {
    this.notify({ type: 'agent_waiting_input', title: 'Input Required', body: 'Agent is waiting for your input', sessionId });
  }
}

export const notificationService = new NotificationService();