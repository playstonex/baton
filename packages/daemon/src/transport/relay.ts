import { generateKeyPair, keyToFingerprint } from '@flowwhips/shared/crypto';
import type { DaemonMessage } from '@flowwhips/shared';

interface RelayConnectionOptions {
  relayUrl: string;
  hostId: string;
  token: string;
  onMessage: (msg: DaemonMessage) => void;
  onStatusChange: (connected: boolean) => void;
}

const OPEN = 1;

export class RelayConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private keyPair: ReturnType<typeof generateKeyPair> | null = null;
  private encryptionReady = false;

  constructor(private options: RelayConnectionOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.ws?.readyState === OPEN) return;

    this.keyPair = generateKeyPair();
    const fp = keyToFingerprint(this.keyPair.publicKey);
    const url = `${this.options.relayUrl}?role=host&hostId=${this.options.hostId}&publicKeyFingerprint=${fp}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`Connected to Relay: ${this.options.relayUrl}`);
      this._connected = true;
      this.reconnectAttempts = 0;
      this.options.onStatusChange(true);
      this.startHeartbeat();

      this.ws!.send(
        JSON.stringify({
          type: 'register',
          role: 'host',
          hostId: this.options.hostId,
          token: this.options.token,
        }),
      );

      this.ws!.send(
        JSON.stringify({
          type: 'key_exchange',
          publicKey: btoa(String.fromCharCode(...this.keyPair!.publicKey)),
        }),
      );
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'welcome' || msg.type === 'registered' || msg.type === 'pong') return;

        if (msg.type === 'key_exchange_done') {
          console.log('E2EE encryption enabled');
          this.encryptionReady = true;
          return;
        }

        if (msg.type === 'encrypted' && msg.payload) {
          return;
        }

        this.options.onMessage(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.options.onStatusChange(false);
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will handle reconnect
    };
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === OPEN) {
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
      if (this.ws?.readyState === OPEN) {
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

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`Reconnecting to Relay in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
