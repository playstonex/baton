import type { DaemonMessage } from '@flowwhips/shared';

type MessageHandler = (msg: DaemonMessage) => void;

export type ConnectionMode = 'local' | 'remote';

interface ConnectionConfig {
  mode: ConnectionMode;
  localWsUrl?: string;
  localHttpUrl?: string;
  relayUrl?: string;
  hostId?: string;
  token?: string;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private config: ConnectionConfig = { mode: 'local' };

  get connected(): boolean {
    return this._connected;
  }

  get mode(): ConnectionMode {
    return this.config.mode;
  }

  get httpUrl(): string {
    return this.config.localHttpUrl ?? `http://${window.location.hostname}:3210`;
  }

  configure(config: Partial<ConnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  connect(): void {
    this.disconnect();

    let url: string;
    if (this.config.mode === 'remote' && this.config.relayUrl) {
      // Remote: connect to relay as client
      url = `${this.config.relayUrl}`;
    } else {
      // Local: connect directly to daemon
      url = this.config.localWsUrl ?? `ws://${window.location.hostname}:3211`;
    }

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      this.startHeartbeat();
      this.notifyStateChange();

      if (this.config.mode === 'remote' && this.config.hostId) {
        // Register as client on relay
        this.ws!.send(
          JSON.stringify({
            type: 'register',
            role: 'client',
            hostId: this.config.hostId,
            token: this.config.token,
          }),
        );
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'welcome' || msg.type === 'connected' || msg.type === 'pong') return;
        if (!('sessionId' in msg || 'status' in msg || 'agents' in msg)) return;
        this.dispatch(msg as DaemonMessage);
        this.dispatch(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.stopHeartbeat();
      this.notifyStateChange();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after
    };
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private dispatch(msg: DaemonMessage): void {
    const typeHandlers = this.handlers.get(msg.type);
    if (typeHandlers) for (const h of typeHandlers) h(msg);
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) for (const h of wildcardHandlers) h(msg);
  }

  private notifyStateChange(): void {
    const stateHandlers = this.handlers.get('_state');
    if (stateHandlers) {
      for (const h of stateHandlers) {
        h({ type: 'status_update', sessionId: '', status: this._connected ? 'running' : 'stopped' });
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

export const wsService = new WebSocketService();
