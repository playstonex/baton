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
  private config: ConnectionConfig = { mode: 'local' };
  private intentionalClose = false;
  /**
   * Last seen seq per session, for resume-after-reconnect. Updated whenever a
   * sequenced message (terminal_output/parsed_event/status_update with `seq`)
   * arrives. COMPAT(sessionResume).
   */
  private lastSeq = new Map<string, number>();
  /** Daemon-advertised features from the welcome message. COMPAT(features). */
  private serverFeatures: Record<string, boolean> | undefined;

  /** Check whether the daemon advertised a feature (fail-open before welcome). */
  hasFeature(flag: string): boolean {
    if (!this.serverFeatures) return true;
    return this.serverFeatures[flag] === true;
  }

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
    const next = { ...this.config, ...config };
    // Seq numbers and advertised features belong to ONE daemon. Switching hosts
    // must not resume_session a new daemon with the previous host's lastSeq.
    if (targetKey(next) !== targetKey(this.config)) {
      this.lastSeq.clear();
      this.serverFeatures = undefined;
    }
    this.config = next;
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

    const ws = new WebSocket(url);
    this.ws = ws;
    if (this.config.binaryProtocol) {
      ws.binaryType = 'arraybuffer';
    }

    ws.onopen = () => {
      // Ignore stale sockets that have since been replaced by a new connect().
      if (this.ws !== ws) return;
      this._connected = true;
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

      // Advertise our capabilities so the daemon can gate features. Legacy
      // daemons ignore this (it parses as an unknown control no-op). COMPAT.
      ws.send(
        JSON.stringify({
          type: 'hello',
          version: 2,
          channels: [0, 1, 2],
          capabilities: { chatMode: true, structuredToolCalls: true, sessionResume: true },
        }),
      );
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
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

    ws.onclose = () => {
      // Only react to the close of the *current* socket. A stale socket closing
      // (e.g. after connect() replaced it) must not trigger a spurious reconnect,
      // otherwise we get an infinite connect/disconnect loop.
      if (this.ws !== ws) return;
      this._connected = false;
      this.stopHeartbeat();
      this.notifyStateChange();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
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

    // resume_reply: if the daemon flagged a gap, our lastSeq is behind its
    // buffer — fall back to a full re-attach so we get history_replay.
    if (msg.type === 'resume_reply' && msg.gap && msg.sessionId) {
      this.lastSeq.delete(msg.sessionId);
      this.send({ type: 'control', action: 'attach_session', sessionId: msg.sessionId });
      return;
    }

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

  /**
   * Attach to a session, preferring a seq-based resume when we've previously
   * seen messages from it (reconnect case). Falls back to a full attach when
   * there's no lastSeq to resume from. COMPAT(sessionResume).
   *
   * The daemon advertises sessionResume via its features; if it doesn't, the
   * resume_session action is ignored harmlessly and the client retries attach.
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
      // If a successful connect() happened in the meantime, don't disturb it.
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      this.connect();
    }, 3000);
  }
}

export const wsService = new WebSocketService();
