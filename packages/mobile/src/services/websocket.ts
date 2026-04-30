import type { DaemonMessage } from '@baton/shared';
import { Channel, decodeFrame, decodeJsonFrame } from '@baton/shared/protocol';
import { AppState, type AppStateStatus } from 'react-native';

type MessageHandler = (msg: DaemonMessage) => void;

export interface ConnectionConfig {
  mode: 'local' | 'remote';
  relayUrl?: string;
  hostId?: string;
  token?: string;
  localWsUrl?: string;
  localHttpUrl?: string;
  binaryProtocol?: boolean;
}

function isBinaryData(data: unknown): data is ArrayBuffer {
  return typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private config: ConnectionConfig = { mode: 'remote' };
  private reconnectDelay = 1000;
  private reconnectAttempts = 0;
  private activeSessionId: string | null = null;
  private appStateSub: { remove: () => void } | null = null;

  private static readonly MAX_RECONNECT_ATTEMPTS = 20;

  get connected(): boolean {
    return this._connected;
  }

  configure(config: Partial<ConnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  connect(): void {
    this.disconnect();
    this.reconnectDelay = 1000;
    this.reconnectAttempts = 0;

    this.appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && !this._connected && !this.reconnectTimer) {
        this.connect();
      }
    });

    let url: string;
    if (this.config.mode === 'remote' && this.config.relayUrl) {
      url = this.config.relayUrl;
    } else {
      url = this.config.localWsUrl ?? 'ws://localhost:3211';
    }

    this.ws = new WebSocket(url);
    if (this.config.binaryProtocol) {
      this.ws.binaryType = 'arraybuffer';
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
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

    this.ws.onmessage = (e: WebSocketMessageEvent) => {
      try {
        if (isBinaryData(e.data)) {
          this.handleBinaryMessage(e.data as ArrayBuffer);
        } else {
          this.handleTextMessage(e.data as string);
        }
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.activeSessionId = null;
      this.stopHeartbeat();
      this.notifyStateChange();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after
    };
  }

  private handleTextMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.type === 'welcome' || msg.type === 'connected' || msg.type === 'pong') return;
    this.dispatch(msg as DaemonMessage);
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const frame = decodeFrame(bytes);

    switch (frame.channel) {
      case Channel.Control: {
        const ctrl = decodeJsonFrame<Record<string, unknown>>(frame);
        this.dispatch(ctrl as unknown as DaemonMessage);
        break;
      }
      case Channel.Terminal: {
        const text = new TextDecoder().decode(frame.payload);
        this.dispatch({ type: 'terminal_output', sessionId: this.activeSessionId ?? '', data: text } as DaemonMessage);
        break;
      }
      case Channel.Events: {
        const event = decodeJsonFrame<Record<string, unknown>>(frame);
        this.dispatch(event as unknown as DaemonMessage);
        break;
      }
    }
  }

  send(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (msg && typeof msg === 'object' && 'type' in msg) {
      const m = msg as Record<string, unknown>;
      if (m.type === 'control') {
        if (m.action === 'attach_session' && typeof m.sessionId === 'string') {
          this.activeSessionId = m.sessionId;
        } else if (m.action === 'detach_session') {
          this.activeSessionId = null;
        }
      }
    }

    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
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
          status: this._connected ? ('running' as const) : ('stopped' as const),
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
    if (this.reconnectAttempts >= WebSocketService.MAX_RECONNECT_ATTEMPTS) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}

export const wsService = new WebSocketService();
