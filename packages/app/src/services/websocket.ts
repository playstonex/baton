import type { DaemonMessage } from '@baton/shared';
import { Channel, decodeFrame, decodeJsonFrame } from '@baton/shared/protocol';

type MessageHandler = (msg: DaemonMessage) => void;

export type ConnectionMode = 'local' | 'remote';

interface ConnectionConfig {
  mode: ConnectionMode;
  localWsUrl?: string;
  localHttpUrl?: string;
  relayUrl?: string;
  hostId?: string;
  token?: string;
  binaryProtocol?: boolean;
}

function isBinaryData(data: unknown): data is ArrayBuffer | Blob {
  return data instanceof ArrayBuffer || data instanceof Blob;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private config: ConnectionConfig = { mode: 'local' };
  private intentionalClose = false;

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
    this.intentionalClose = false;

    let url: string;
    if (this.config.mode === 'remote' && this.config.relayUrl) {
      url = `${this.config.relayUrl}`;
    } else {
      url = this.config.localWsUrl ?? `ws://${window.location.hostname}:3211`;
    }

    this.ws = new WebSocket(url);
    if (this.config.binaryProtocol) {
      this.ws.binaryType = 'arraybuffer';
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.startHeartbeat();
      this.notifyStateChange();

      if (this.config.mode === 'remote' && this.config.hostId) {
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
        if (isBinaryData(e.data)) {
          this.handleBinaryMessage(e.data);
        } else {
          this.handleTextMessage(e.data);
        }
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.stopHeartbeat();
      this.notifyStateChange();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose fires after
    };
  }

  private handleTextMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.type === 'welcome' || msg.type === 'connected' || msg.type === 'pong') return;
    if (!('sessionId' in msg || 'status' in msg || 'agents' in msg)) return;
    this.dispatch(msg as DaemonMessage);
  }

  private handleBinaryMessage(data: ArrayBuffer | Blob): void {
    const arrayBuffer = data instanceof Blob ? data.arrayBuffer() : Promise.resolve(data);
    arrayBuffer.then((buffer) => {
      const bytes = new Uint8Array(buffer);
      const frame = decodeFrame(bytes);

      switch (frame.channel) {
        case Channel.Control: {
          const ctrl = decodeJsonFrame<Record<string, unknown>>(frame);
          if (ctrl.type === 'welcome') {
            // intentionally empty — handshake ack
          }
          this.dispatch(ctrl as unknown as DaemonMessage);
          break;
        }
        case Channel.Terminal: {
          const text = new TextDecoder().decode(frame.payload);
          const handlers = this.handlers.get('terminal_output');
          if (handlers) {
            for (const h of handlers) {
              h({ type: 'terminal_output', sessionId: '', data: text } as DaemonMessage);
            }
          }
          break;
        }
        case Channel.Events: {
          const event = decodeJsonFrame<Record<string, unknown>>(frame);
          this.dispatch(event as unknown as DaemonMessage);
          break;
        }
      }
    });
  }

  send(msg: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.intentionalClose = true;
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
        h({
          type: 'status_update',
          sessionId: '',
          status: this._connected ? 'running' : 'stopped',
        });
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
