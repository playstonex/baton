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

/** Identity of the daemon a config points at (credentials excluded). */
function targetKey(c: Partial<ConnectionConfig>): string {
  return [c.mode, c.relayUrl, c.hostId, c.localWsUrl, c.localHttpUrl].join('|');
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
  private onErrorCallback: ((attempt: number) => void) | null = null;
  /**
   * Last seen seq per session, for resume-after-reconnect.
   * COMPAT(sessionResume).
   */
  private lastSeq = new Map<string, number>();
  /** Daemon-advertised features from the welcome message. COMPAT(features). */
  private serverFeatures: Record<string, boolean> | undefined;

  /** Check whether the daemon advertised a feature (fail-open before welcome). */
  hasFeature(flag: string): boolean {
    if (!this.serverFeatures) return true;
    return this.serverFeatures[flag] === true;
  }
  /** Background-disconnect timer. After BG grace period, close to save power. */
  private backgroundDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True when WE closed the socket (background, manual disconnect). Suppresses
   * the auto-reconnect that would otherwise fire from onclose. */
  private intentionalClose = false;

  /** Grace period before backgrounding closes the socket. Tunable. */
  static readonly BACKGROUND_DISCONNECT_MS = 60_000;

  get connected(): boolean {
    return this._connected;
  }

  configure(config: Partial<ConnectionConfig>): void {
    const next = { ...this.config, ...config };
    // Seq numbers and advertised features belong to ONE daemon. Switching hosts
    // must not resume_session a new daemon with the previous host's lastSeq.
    if (targetKey(next) !== targetKey(this.config)) {
      this.lastSeq.clear();
      this.serverFeatures = undefined;
    }
    this.config = next;
  }

  onError(cb: (attempt: number) => void): void {
    this.onErrorCallback = cb;
  }

  connect(): void {
    this.disconnect();
    this.reconnectDelay = 1000;
    this.intentionalClose = false;

    this.appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // Cancel any pending background-disconnect; reconnect if we dropped.
        this.clearBackgroundDisconnect();
        if (!this._connected && !this.reconnectTimer) {
          this.connect();
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Defer disconnecting — a quick app switch shouldn't drop the socket.
        // After the grace period still in the background, close to save power
        // and free the relay connection.
        this.scheduleBackgroundDisconnect();
      }
    });

    let url: string;
    if (this.config.mode === 'remote' && this.config.relayUrl) {
      url = this.config.relayUrl;
    } else {
      url = this.config.localWsUrl ?? 'ws://localhost:3211';
    }

    const ws = new WebSocket(url);
    this.ws = ws;
    if (this.config.binaryProtocol) {
      ws.binaryType = 'arraybuffer';
    }

    ws.onopen = () => {
      // Stale socket: a newer connect() replaced this one (e.g. host switch).
      // Its close event lands later and must not disturb the live connection.
      if (this.ws !== ws) return;
      this._connected = true;
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.notifyStateChange();

      if (this.config.mode === 'remote' && this.config.hostId) {
        ws.send(
          JSON.stringify({
            type: 'register',
            role: 'client',
            hostId: this.config.hostId,
            token: this.config.token,
          }),
        );
      }

      // Advertise capabilities so the daemon can gate features. Legacy
      // daemons ignore this. COMPAT(features).
      ws.send(
        JSON.stringify({
          type: 'hello',
          version: 2,
          channels: [0, 1, 2],
          capabilities: { chatMode: true, structuredToolCalls: true },
        }),
      );
    };

    ws.onmessage = (e: WebSocketMessageEvent) => {
      if (this.ws !== ws) return;
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

    ws.onclose = () => {
      // connect() resets intentionalClose right after disconnect(), long
      // before the old socket's close event arrives — so first check whether
      // this socket is still the current one before counting an error.
      if (this.ws !== ws) return;
      this._connected = false;
      this.activeSessionId = null;
      this.stopHeartbeat();
      this.notifyStateChange();
      // Don't auto-reconnect when WE closed it (background grace, manual
      // disconnect). The AppState listener re-connects on return-to-foreground.
      if (this.intentionalClose) {
        this.intentionalClose = false;
        return;
      }
      this.reconnectAttempts++;
      if (this.onErrorCallback) this.onErrorCallback(this.reconnectAttempts);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after
    };
  }

  private handleTextMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg.type === 'connected' || msg.type === 'pong') return;

    // Capture daemon-advertised features for capability gating. COMPAT(features).
    if (msg.type === 'welcome' && msg.features) {
      this.serverFeatures = msg.features as Record<string, boolean>;
    }
    if (msg.type === 'welcome') return;

    // COMPAT(sessionResume): track the high-water seq per session.
    if (typeof msg.seq === 'number' && typeof msg.sessionId === 'string') {
      this.lastSeq.set(msg.sessionId, msg.seq);
    }

    // resume_reply with gap: our lastSeq is behind the daemon's buffer —
    // fall back to a full re-attach to recover via history_replay.
    if (msg.type === 'resume_reply' && msg.gap && msg.sessionId) {
      this.lastSeq.delete(msg.sessionId);
      this.send({ type: 'control', action: 'attach_session', sessionId: msg.sessionId });
      return;
    }

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
        this.dispatch({
          type: 'terminal_output',
          sessionId: this.activeSessionId ?? '',
          data: text,
        } as DaemonMessage);
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
        if (
          (m.action === 'attach_session' || m.action === 'resume_session') &&
          typeof m.sessionId === 'string'
        ) {
          this.activeSessionId = m.sessionId;
        } else if (m.action === 'detach_session') {
          this.activeSessionId = null;
        }
      }
    }

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Attach to a session, preferring a seq-based resume when we've previously
   * seen messages from it (reconnect case). Falls back to a full attach when
   * there's no lastSeq to resume from. COMPAT(sessionResume).
   */
  attachOrResume(sessionId: string): void {
    const last = this.lastSeq.get(sessionId);
    if (last !== undefined) {
      this.send({
        type: 'control',
        action: 'resume_session',
        sessionId,
        payload: { lastSeq: last },
      });
      return;
    }
    this.send({ type: 'control', action: 'attach_session', sessionId });
  }

  /** Forget the resume position for a session (e.g. after explicit detach). */
  clearResume(sessionId: string): void {
    this.lastSeq.delete(sessionId);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearBackgroundDisconnect();
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  /** Schedule a deferred socket close after the background grace period. */
  private scheduleBackgroundDisconnect(): void {
    if (this.backgroundDisconnectTimer || !this._connected) return;
    this.backgroundDisconnectTimer = setTimeout(() => {
      this.backgroundDisconnectTimer = null;
      if (this._connected) {
        // Intentional — suppress the auto-reconnect in onclose. Deliberately
        // keep the AppState subscription: it is what reconnects us on
        // return-to-foreground. Tearing it down here (via disconnect())
        // used to leave the app permanently offline after one background
        // grace period — HTTP still worked, so the dashboard showed stale
        // "running" rows while chat had no connection at all.
        this.intentionalClose = true;
        this.clearBackgroundDisconnect();
        this.stopHeartbeat();
        this.activeSessionId = null;
        this.ws?.close();
        this.ws = null;
        this._connected = false;
        this.notifyStateChange();
      }
    }, WebSocketService.BACKGROUND_DISCONNECT_MS);
  }

  private clearBackgroundDisconnect(): void {
    if (this.backgroundDisconnectTimer) {
      clearTimeout(this.backgroundDisconnectTimer);
      this.backgroundDisconnectTimer = null;
    }
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
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}

export const wsService = new WebSocketService();
