import type { AgentManager } from '../agent/manager.js';
import type {
  ClientMessage,
  DaemonMessage,
  ParsedEvent,
  TerminalOutputMessage,
  ParsedEventMessage,
  StatusUpdateMessage,
} from '@baton/shared';
import { parseClientMessage } from '@baton/shared/protocol';
import { SeqBuffer } from '@baton/shared/protocol';
import { createWelcome, DEFAULT_SERVER_FEATURES } from '@baton/shared/protocol';
import type { AccessMode } from '@baton/shared';

type BunWebSocket = import('bun').ServerWebSocket<{ clientId: string }>;

interface Client {
  id: string;
  ws: BunWebSocket;
  subscriptions: Set<string>;
  /** Capabilities advertised by the client in its `hello` message. Undefined
   * until (and unless) the client sends hello. COMPAT(features). */
  capabilities?: Record<string, boolean>;
}

const OPEN = 1;

export class Transport {
  private server: ReturnType<typeof Bun.serve<{ clientId: string }>> | null = null;
  private clients = new Map<string, Client>();
  private registeredSessions = new Set<string>();
  private sessionUnsubs = new Map<string, { unsubRaw: () => void; unsubEvent: () => void }>();
  private sessionOwners = new Map<string, string>();
  private localClientId: string | null = null;
  private accessModes = new Map<string, AccessMode>();
  /** Outbound relay sink — set while a relay connection is up. Session
   * streams (emitSequenced) and broadcasts are forwarded through it so
   * remote clients see the same live data as local ones. */
  private relaySink: ((msg: DaemonMessage) => void) | null = null;
  /** Sessions a remote (relay) client attached to — only these stream over
   * the relay, instead of leaking every local session's output. */
  private relaySessions = new Set<string>();
  /** Per-session seq buffers for resume-after-reconnect. COMPAT(sessionResume). */
  private seqBuffers = new Map<string, SeqBuffer>();
  private onPushTokenRegister?: (clientId: string, token: string, platform: string) => void;
  private onPushTokenUnregister?: (clientId: string) => void;
  private onAccessModeChange?: (mode: AccessMode) => void;

  constructor(
    private agentManager: AgentManager,
    private port: number,
    opts?: {
      onPushTokenRegister?: (clientId: string, token: string, platform: string) => void;
      onPushTokenUnregister?: (clientId: string) => void;
      onAccessModeChange?: (mode: AccessMode) => void;
    },
  ) {
    this.onPushTokenRegister = opts?.onPushTokenRegister;
    this.onPushTokenUnregister = opts?.onPushTokenUnregister;
    this.onAccessModeChange = opts?.onAccessModeChange;
  }

  start(): void {
    const clients = this.clients;
    const self = this;

    const hostname = process.env.HOST || '::';

    this.server = Bun.serve<{ clientId: string }>({
      fetch(req, server) {
        if (server.upgrade(req, { data: { clientId: '' } })) {
          return;
        }
        return new Response('WebSocket expected', { status: 400 });
      },
      websocket: {
        // Base64 image attachments ride inside chat_input frames — the 16MB
        // Bun default would silently drop a 4-image message at the socket.
        maxPayloadLength: 32 * 1024 * 1024,
        open(ws: import('bun').ServerWebSocket<{ clientId: string }>) {
          const clientId = crypto.randomUUID();
          ws.data = { clientId };
          const client: Client = { id: clientId, ws, subscriptions: new Set() };
          clients.set(clientId, client);
          if (!self.localClientId) self.localClientId = clientId;
          console.log(`[WS] Client connected: ${clientId.slice(0, 8)} (total: ${clients.size})`);
          // Send a welcome carrying server version + features, so capability
          // gating works. Legacy clients swallow `welcome` (they only key off
          // `agent_list`), so this is backward compatible. COMPAT(features).
          self.sendWelcome(clientId);
          self.sendAgentList(clientId);
        },
        message(ws: import('bun').ServerWebSocket<{ clientId: string }>, message: string | Buffer) {
          const clientId = ws.data.clientId;
          let parsed: unknown;
          try {
            parsed = JSON.parse(message.toString());
          } catch {
            self.send(clientId, { type: 'error', message: 'Invalid JSON' });
            return;
          }
          // Boundary validation: reject malformed messages here rather than
          // letting them crash deep inside the agent manager. Gracefully
          // echoes back a structured error so the client can react.
          const result = parseClientMessage(parsed);
          if (!result.ok) {
            self.send(clientId, { type: 'error', message: result.error, code: 'INVALID_MESSAGE' });
            return;
          }
          self.handleMessage(clientId, result.value);
        },
        close(ws: import('bun').ServerWebSocket<{ clientId: string }>) {
          const clientId = ws.data.clientId;
          console.log(`[WS] Client disconnected: ${clientId.slice(0, 8)}`);
          if (self.localClientId === clientId) {
            const remaining = Array.from(clients.values()).filter((c) => c.id !== clientId);
            self.localClientId = remaining[0]?.id ?? null;
          }
          for (const [sid, ownerId] of self.sessionOwners.entries()) {
            if (ownerId === clientId) {
              self.sessionOwners.delete(sid);
              self.broadcast({
                type: 'session_ownership',
                sessionId: sid,
                owner: 'local',
                claimedBy: self.localClientId ?? '',
              });
            }
          }
          self.accessModes.delete(clientId);
          clients.delete(clientId);
        },
      },
      hostname,
      port: this.port + 1,
    });

    console.log(`WebSocket server listening on ws://localhost:${this.port + 1}`);
  }

  private handleMessage(clientId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello': {
        // Client advertises its capabilities. Store for later gating. A
        // client that never sends hello is treated as legacy (fail-open).
        const client = this.clients.get(clientId);
        if (client) {
          client.capabilities = msg.capabilities as Record<string, boolean> | undefined;
        }
        break;
      }

      case 'ping': {
        // Clients heartbeat every 30s; before this was schema'd the daemon
        // answered each one with an INVALID_MESSAGE error frame.
        this.send(clientId, { type: 'pong' });
        break;
      }

      case 'terminal_input': {
        try {
          this.agentManager.write(msg.sessionId, msg.data);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : `Session ${msg.sessionId} not found`,
          });
        }
        break;
      }

      case 'chat_input': {
        try {
          this.agentManager.chatWrite(msg.sessionId, msg.content, msg.images);
          if (msg.messageId) {
            this.send(clientId, { type: 'ack', status: 'ok', messageId: msg.messageId });
          }
        } catch (err) {
          if (msg.messageId) {
            this.send(clientId, {
              type: 'ack',
              status: 'error',
              messageId: msg.messageId,
              error: err instanceof Error ? err.message : 'chatWrite failed',
            });
          } else {
            this.send(clientId, {
              type: 'error',
              message: err instanceof Error ? err.message : 'chatWrite failed',
            });
          }
        }
        break;
      }

      case 'steer_input': {
        try {
          this.agentManager.steer(msg.sessionId, msg.content);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'steer failed',
          });
        }
        break;
      }

      case 'cancel_turn': {
        try {
          void this.agentManager.cancelTurn(msg.sessionId);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'cancelTurn failed',
          });
        }
        break;
      }

      case 'approve_input': {
        try {
          void this.agentManager.approve(msg.sessionId, msg.reason);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'approve failed',
          });
        }
        break;
      }

      case 'reject_input': {
        try {
          void this.agentManager.reject(msg.sessionId, msg.reason);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'reject failed',
          });
        }
        break;
      }

      case 'model_list_request': {
        try {
          void this.agentManager.listModels(msg.sessionId).then((models) => {
            this.send(clientId, {
              type: 'model_list',
              sessionId: msg.sessionId,
              models,
              selected: this.agentManager.getSelectedModel(msg.sessionId),
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'listModels failed',
          });
        }
        break;
      }

      case 'model_select': {
        try {
          this.agentManager.setModel(msg.sessionId, msg.model);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'setModel failed',
          });
        }
        break;
      }

      case 'reasoning_effort_select': {
        try {
          this.agentManager.setReasoningEffort(msg.sessionId, msg.effort);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'setReasoningEffort failed',
          });
        }
        break;
      }

      case 'thinking_config_select': {
        try {
          this.agentManager.setThinkingConfig(msg.sessionId, msg.config);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'setThinkingConfig failed',
          });
        }
        break;
      }

      case 'access_mode_select': {
        try {
          this.agentManager.setAccessMode(msg.sessionId, msg.mode);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'setAccessMode failed',
          });
        }
        break;
      }

      case 'service_tier_select': {
        try {
          this.agentManager.setServiceTier(msg.sessionId, msg.tier);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'setServiceTier failed',
          });
        }
        break;
      }

      case 'git_branch_list_request': {
        try {
          void this.agentManager
            .listGitBranches(msg.sessionId)
            .then(({ branches, currentBranch }) => {
              this.send(clientId, {
                type: 'git_branch_list',
                sessionId: msg.sessionId,
                branches,
                currentBranch,
              });
            });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'listGitBranches failed',
          });
        }
        break;
      }

      case 'git_branch_select': {
        try {
          void this.agentManager.gitCheckout(msg.sessionId, msg.branch).then((r) => {
            this.send(clientId, {
              type: 'git_result',
              sessionId: msg.sessionId,
              action: 'checkout',
              operation: 'checkout',
              success: r.success,
              error: r.error,
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitCheckout failed',
          });
        }
        break;
      }

      case 'git_status_request': {
        try {
          void Promise.all([
            this.agentManager.gitStatus(msg.sessionId),
            this.agentManager.gitDiff(msg.sessionId),
          ]).then(([status, diff]) => {
            this.send(clientId, {
              type: 'git_status',
              sessionId: msg.sessionId,
              status,
              diff,
              projectPath: this.agentManager.getProjectPath(msg.sessionId),
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitStatus failed',
          });
        }
        break;
      }

      case 'git_commit': {
        try {
          void this.agentManager.gitCommit(msg.sessionId, msg.message).then((r) => {
            this.send(clientId, {
              type: 'git_result',
              sessionId: msg.sessionId,
              action: 'commit',
              operation: 'commit',
              success: r.success,
              error: r.error,
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitCommit failed',
          });
        }
        break;
      }

      case 'git_push': {
        try {
          void this.agentManager.gitPush(msg.sessionId).then((r) => {
            this.send(clientId, {
              type: 'git_result',
              sessionId: msg.sessionId,
              action: 'push',
              operation: 'push',
              success: r.success,
              error: r.error,
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitPush failed',
          });
        }
        break;
      }

      case 'git_pull': {
        try {
          void this.agentManager.gitPull(msg.sessionId).then((r) => {
            this.send(clientId, {
              type: 'git_result',
              sessionId: msg.sessionId,
              action: 'pull',
              operation: 'pull',
              success: r.success,
              error: r.error,
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitPull failed',
          });
        }
        break;
      }

      case 'git_create_branch': {
        try {
          void this.agentManager.gitCreateBranch(msg.sessionId, msg.name).then((r) => {
            this.send(clientId, {
              type: 'git_result',
              sessionId: msg.sessionId,
              action: 'create_branch',
              operation: 'create_branch',
              success: r.success,
              error: r.error,
            });
          });
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'gitCreateBranch failed',
          });
        }
        break;
      }

      case 'control':
        this.handleControl(clientId, msg);
        break;
    }
  }

  private async handleControl(
    clientId: string,
    msg: Extract<ClientMessage, { type: 'control' }>,
  ): Promise<void> {
    switch (msg.action) {
      case 'list_agents': {
        this.sendAgentList(clientId);
        break;
      }

      case 'stop_agent': {
        if (!msg.sessionId) return;
        try {
          await this.agentManager.stop(msg.sessionId);
          this.handleSessionStopped(msg.sessionId);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to stop agent',
          });
        }
        break;
      }

      case 'attach_session': {
        if (!msg.sessionId) return;
        const client = this.clients.get(clientId);
        if (!client) {
          console.log(`[ATTACH] No client found for ${clientId.slice(0, 8)}`);
          return;
        }

        if (!this.agentManager.get(msg.sessionId)) {
          console.log(
            `[ATTACH] Session not found: ${msg.sessionId.slice(0, 8)} (client: ${clientId.slice(0, 8)})`,
          );
          this.send(clientId, {
            type: 'error',
            message: `Session ${msg.sessionId} not found`,
          });
          return;
        }

        client.subscriptions.add(msg.sessionId);
        this.ensureSessionRegistered(msg.sessionId);

        try {
          for (const reply of this.buildAttachReplay(msg.sessionId)) {
            this.send(clientId, reply);
          }
        } catch (err) {
          console.log(`[ATTACH] Error replaying history for ${msg.sessionId.slice(0, 8)}: ${err}`);
        }
        break;
      }

      case 'resume_session': {
        // COMPAT(sessionResume): a reconnecting client that advertised the
        // sessionResume capability asks to be caught up rather than full-replay.
        if (!msg.sessionId) return;
        const client = this.clients.get(clientId);
        if (!client) return;

        if (!this.agentManager.get(msg.sessionId)) {
          this.send(clientId, {
            type: 'error',
            message: `Session ${msg.sessionId} not found`,
          });
          return;
        }

        client.subscriptions.add(msg.sessionId);
        this.ensureSessionRegistered(msg.sessionId);

        const lastSeq = (msg.payload as { lastSeq?: number } | undefined)?.lastSeq ?? 0;
        const buf = this.seqBuffers.get(msg.sessionId);
        if (!buf) {
          // Session registered but no buffer (shouldn't happen) — fall back.
          this.send(clientId, {
            type: 'resume_reply',
            sessionId: msg.sessionId,
            fromSeq: 0,
            toSeq: 0,
            currentSeq: 0,
            gap: true,
          });
          return;
        }

        const replay = buf.replay(lastSeq);
        for (const m of replay.messages) {
          const client2 = this.clients.get(clientId);
          if (client2?.ws.readyState === OPEN) {
            client2.ws.send(JSON.stringify(m));
          }
        }
        this.send(clientId, {
          type: 'resume_reply',
          sessionId: msg.sessionId,
          fromSeq: replay.fromSeq,
          toSeq: replay.toSeq,
          currentSeq: replay.currentSeq,
          gap: replay.gap,
        });
        break;
      }

      case 'detach_session': {
        if (!msg.sessionId) return;
        const client = this.clients.get(clientId);
        if (client) client.subscriptions.delete(msg.sessionId);
        break;
      }

      case 'resize': {
        if (!msg.sessionId || !msg.payload) return;
        const { cols, rows } = msg.payload as { cols: number; rows: number };
        try {
          this.agentManager.resize(msg.sessionId, cols, rows);
        } catch {
          // ignore
        }
        break;
      }

      case 'claim_session': {
        if (!msg.sessionId) return;
        this.sessionOwners.set(msg.sessionId, clientId);
        this.broadcast({
          type: 'session_ownership',
          sessionId: msg.sessionId,
          owner: clientId === this.localClientId ? 'local' : 'remote',
          claimedBy: clientId,
        });
        break;
      }

      case 'release_session': {
        if (!msg.sessionId) return;
        this.sessionOwners.delete(msg.sessionId);
        this.broadcast({
          type: 'session_ownership',
          sessionId: msg.sessionId,
          owner: 'local',
          claimedBy: this.localClientId ?? clientId,
        });
        break;
      }

      case 'permission_response': {
        // Deliberately inert, and kept as an explicit no-op rather than
        // removed: real permission answers travel on approve_input /
        // reject_input (SDK/ACP) or raw terminal_input (PTY). Handling this
        // action too would answer every prompt twice.
        break;
      }

      case 'register_push_token': {
        if (!msg.payload) return;
        const { token, platform } = msg.payload as { token: string; platform: string };
        this.onPushTokenRegister?.(clientId, token, platform);
        break;
      }

      case 'unregister_push_token': {
        this.onPushTokenUnregister?.(clientId);
        break;
      }

      case 'set_access_mode': {
        if (!msg.payload) return;
        const { mode } = msg.payload as { mode: AccessMode };
        this.accessModes.set(clientId, mode);
        this.onAccessModeChange?.(mode);
        this.broadcast({
          type: 'access_mode',
          mode,
        } as DaemonMessage);
        break;
      }
    }
  }

  /**
   * Build the bounded attach-replay frames for a session (shared by the WS
   * attach path and the relay attach path). Bounded tail only: deep history
   * lives in the session store, reachable via GET /api/sessions.
   */
  private buildAttachReplay(sessionId: string): DaemonMessage[] {
    const replies: DaemonMessage[] = [];

    const history = this.agentManager.getDisplayHistoryTail(sessionId);
    if (history.length > 0) {
      replies.push({
        type: 'history_replay',
        sessionId,
        output: history.join(''),
      });
    }

    const events = this.agentManager.getEventHistoryTail(sessionId);
    if (events.length > 0) {
      replies.push({ type: 'event_history', sessionId, events });
    }

    const proc = this.agentManager.get(sessionId);
    if (proc) {
      replies.push({
        type: 'status_update',
        sessionId,
        status: proc.status,
        detail: this.agentManager.getStatusDetail(sessionId),
      });
    }

    const ownerId = this.sessionOwners.get(sessionId);
    if (ownerId) {
      replies.push({
        type: 'session_ownership',
        sessionId,
        owner: ownerId === this.localClientId ? 'local' : 'remote',
        claimedBy: ownerId,
      });
    }
    return replies;
  }

  // ── Relay (remote client) path ───────────────────────────────────

  /** Wire (or clear) the outbound relay sink. Pass null on disconnect. */
  attachRelaySink(sink: ((msg: DaemonMessage) => void) | null): void {
    this.relaySink = sink;
    if (!sink) this.relaySessions.clear();
  }

  /**
   * Handle a ClientMessage that arrived over the relay from a remote client.
   * Replies and session streams flow back through the relay sink. This used
   * to be one hardcoded terminal_input forwarding in index.ts — remote
   * clients could type but never see any output.
   */
  handleRelayMessage(msg: ClientMessage): void {
    const reply = (m: DaemonMessage): void => {
      this.relaySink?.(m);
    };

    switch (msg.type) {
      case 'hello': {
        reply(
          createWelcome(
            `relay-${crypto.randomUUID()}`,
            this.agentManager.list().map((a) => ({
              id: a.id,
              type: a.type,
              status: a.status,
              projectPath: a.projectPath,
            })),
            DEFAULT_SERVER_FEATURES,
          ),
        );
        break;
      }

      case 'terminal_input':
      case 'chat_input':
      case 'steer_input':
      case 'cancel_turn':
      case 'approve_input':
      case 'reject_input': {
        try {
          if (msg.type === 'terminal_input') this.agentManager.write(msg.sessionId, msg.data);
          else if (msg.type === 'chat_input') this.agentManager.chatWrite(msg.sessionId, msg.content);
          else if (msg.type === 'steer_input') this.agentManager.steer(msg.sessionId, msg.content);
          else if (msg.type === 'cancel_turn') void this.agentManager.cancelTurn(msg.sessionId);
          else if (msg.type === 'approve_input') void this.agentManager.approve(msg.sessionId, msg.reason);
          else void this.agentManager.reject(msg.sessionId, msg.reason);
        } catch (err) {
          reply({
            type: 'error',
            message: err instanceof Error ? err.message : `${msg.type} failed`,
          });
        }
        break;
      }

      case 'control': {
        void this.handleRelayControl(msg, reply);
        break;
      }

      default:
        // model/git request families go through their WS handlers; remote
        // clients use the HTTP API for those (the relay only carries the
        // session-stream critical path).
        break;
    }
  }

  private async handleRelayControl(
    msg: Extract<ClientMessage, { type: 'control' }>,
    reply: (m: DaemonMessage) => void,
  ): Promise<void> {
    switch (msg.action) {
      case 'attach_session': {
        if (!msg.sessionId) return;
        if (!this.agentManager.get(msg.sessionId)) {
          reply({ type: 'error', message: `Session ${msg.sessionId} not found` });
          return;
        }
        this.relaySessions.add(msg.sessionId);
        this.ensureSessionRegistered(msg.sessionId);
        for (const frame of this.buildAttachReplay(msg.sessionId)) reply(frame);
        break;
      }

      case 'detach_session': {
        if (msg.sessionId) this.relaySessions.delete(msg.sessionId);
        break;
      }

      case 'resume_session': {
        if (!msg.sessionId) return;
        if (!this.agentManager.get(msg.sessionId)) {
          reply({ type: 'error', message: `Session ${msg.sessionId} not found` });
          return;
        }
        this.relaySessions.add(msg.sessionId);
        this.ensureSessionRegistered(msg.sessionId);
        const lastSeq = (msg.payload as { lastSeq?: number } | undefined)?.lastSeq ?? 0;
        const buf = this.seqBuffers.get(msg.sessionId);
        if (!buf) {
          reply({
            type: 'resume_reply',
            sessionId: msg.sessionId,
            fromSeq: 0,
            toSeq: 0,
            currentSeq: 0,
            gap: true,
          });
          return;
        }
        const replay = buf.replay(lastSeq);
        for (const m of replay.messages) reply(m);
        reply({
          type: 'resume_reply',
          sessionId: msg.sessionId,
          fromSeq: replay.fromSeq,
          toSeq: replay.toSeq,
          currentSeq: replay.currentSeq,
          gap: replay.gap,
        });
        break;
      }

      case 'stop_agent': {
        if (!msg.sessionId) return;
        try {
          await this.agentManager.stop(msg.sessionId);
          this.handleSessionStopped(msg.sessionId);
        } catch (err) {
          reply({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to stop agent',
          });
        }
        break;
      }

      case 'resize': {
        if (!msg.sessionId || !msg.payload) return;
        const { cols, rows } = msg.payload as { cols: number; rows: number };
        try {
          this.agentManager.resize(msg.sessionId, cols, rows);
        } catch {
          // ignore
        }
        break;
      }

      case 'list_agents': {
        this.broadcastAgentList();
        break;
      }

      default:
        break;
    }
  }

  private ensureSessionRegistered(sessionId: string): void {
    if (this.registeredSessions.has(sessionId)) {
      return;
    }
    this.registeredSessions.add(sessionId);
    this.seqBuffers.set(sessionId, new SeqBuffer());

    const unsubRaw = this.agentManager.onRaw(sessionId, (data, sid) => {
      const msg: DaemonMessage = { type: 'terminal_output', sessionId: sid, data };
      this.emitSequenced(sid, msg);
    });

    const unsubEvent = this.agentManager.onEvent(sessionId, (event: ParsedEvent, sid) => {
      const msg: DaemonMessage = { type: 'parsed_event', sessionId: sid, event };
      this.emitSequenced(sid, msg);

      if (event.type === 'status_change') {
        // State was already synced before the event callbacks fired, so the
        // detail reflects this very transition.
        const statusMsg: DaemonMessage = {
          type: 'status_update',
          sessionId: sid,
          status: event.status,
          detail: this.agentManager.getStatusDetail(sid),
        };
        this.emitSequenced(sid, statusMsg);
      }

      // Auto-approve permissions when any subscribed client has full-access mode
      if (event.type === 'permission_request' && this.hasFullAccessClient(sid)) {
        this.agentManager.write(sid, 'y\n');
      }
    });

    this.sessionUnsubs.set(sessionId, { unsubRaw, unsubEvent });
  }

  /**
   * Stamp a sequenced message with the next per-session seq, buffer it for
   * resume, then broadcast to subscribed clients — local AND remote: the
   * relay sink streams any session a remote client attached to. The seq
   * field is additive (optional) so legacy clients that don't advertise
   * sessionResume simply ignore it. COMPAT(sessionResume).
   */
  private emitSequenced(
    sessionId: string,
    msg: TerminalOutputMessage | ParsedEventMessage | StatusUpdateMessage,
  ): void {
    const buf = this.seqBuffers.get(sessionId);
    if (buf) buf.push(msg); // mutates msg.seq
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(sessionId) && client.ws.readyState === OPEN) {
        client.ws.send(payload);
      }
    }
    if (this.relaySink && this.relaySessions.has(sessionId)) {
      this.relaySink(msg);
    }
  }

  registerSessionEvents(sessionId: string): void {
    this.ensureSessionRegistered(sessionId);
  }

  private hasFullAccessClient(sessionId: string): boolean {
    for (const [clientId, mode] of this.accessModes.entries()) {
      if (mode === 'full-access') {
        const client = this.clients.get(clientId);
        if (client && client.subscriptions.has(sessionId) && client.ws.readyState === OPEN) {
          return true;
        }
      }
    }
    return false;
  }

  private sendWelcome(clientId: string): void {
    const agents = this.agentManager.list().map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      projectPath: a.projectPath,
    }));
    this.send(clientId, createWelcome(clientId, agents, DEFAULT_SERVER_FEATURES));
  }

  private sendAgentList(clientId: string): void {
    const agents = this.agentManager.list();
    this.send(clientId, {
      type: 'agent_list',
      agents: agents.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        projectPath: a.projectPath,
        mode: a.mode,
        title: a.title,
        startedAt: a.startedAt,
        lastActivityAt: a.lastActivityAt,
        stoppedAt: a.stoppedAt,
        detail: a.stateDetail,
      })),
    });
  }

  /**
   * Push a fresh agent_list to every connected client. Called whenever the
   * manager reports a session set/status change, so dashboards opened before
   * a session was started (via HTTP, MCP, scheduler, orchestrator…) still
   * see it appear.
   */
  broadcastAgentList(): void {
    const agents = this.agentManager.list();
    this.broadcast({
      type: 'agent_list',
      agents: agents.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        projectPath: a.projectPath,
        mode: a.mode,
        title: a.title,
        startedAt: a.startedAt,
        lastActivityAt: a.lastActivityAt,
        stoppedAt: a.stoppedAt,
        detail: a.stateDetail,
      })),
    });
  }

  /**
   * Post-stop cleanup shared by every stop path (WS stop_agent, HTTP
   * POST /api/agents/:id/stop, archive, delete): drop the resume buffer and
   * tell every client the session ended. Without this, sessions stopped via
   * HTTP kept their seq buffers subscribed until daemon restart.
   */
  handleSessionStopped(sessionId: string): void {
    this.seqBuffers.get(sessionId)?.clear();
    this.seqBuffers.delete(sessionId);
    this.broadcast({
      type: 'status_update',
      sessionId,
      status: 'stopped',
    });
    this.broadcastAgentList();
  }

  send(clientId: string, msg: DaemonMessage): void {
    const client = this.clients.get(clientId);
    if (client?.ws.readyState === OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: DaemonMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === OPEN) {
        client.ws.send(data);
      }
    }
    // Broadcasts are daemon-wide (agent_list, status_update, ownership…) —
    // remote clients get them too.
    this.relaySink?.(msg);
  }

  stop(): void {
    for (const { unsubRaw, unsubEvent } of this.sessionUnsubs.values()) {
      unsubRaw();
      unsubEvent();
    }
    this.sessionUnsubs.clear();
    this.registeredSessions.clear();
    for (const buf of this.seqBuffers.values()) buf.clear();
    this.seqBuffers.clear();
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.server?.stop();
  }
}
