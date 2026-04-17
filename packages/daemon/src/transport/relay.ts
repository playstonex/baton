import WebSocket from 'ws';
import type { DaemonMessage } from '@flowwhips/shared';

interface RelayConnectionOptions {
  relayUrl: string;
  hostId: string;
  token: string;
  onMessage: (msg: DaemonMessage) => void;
  onStatusChange: (connected: boolean) => void;
}

export class RelayConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;

  constructor(private options: RelayConnectionOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = `${this.options.relayUrl}?role=host&hostId=${this.options.hostId}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log(`Connected to Relay: ${this.options.relayUrl}`);
      this._connected = true;
      this.reconnectAttempts = 0;
      this.options.onStatusChange(true);
      this.startHeartbeat();

      // Register as host
      this.ws!.send(
        JSON.stringify({
          type: 'register',
          role: 'host',
          hostId: this.options.hostId,
          token: this.options.token,
        }),
      );
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'welcome' || msg.type === 'registered' || msg.type === 'pong') return;

        // Forward client messages to daemon
        this.options.onMessage(msg);
      } catch {
        // ignore
      }
    });

    this.ws.on('close', () => {
      this._connected = false;
      this.options.onStatusChange(false);
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // onclose will handle reconnect
    });
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

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`Reconnecting to Relay in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
