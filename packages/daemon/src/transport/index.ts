import type { AgentManager } from '../agent/manager.js';
import type {
  ClientMessage,
  DaemonMessage,
  ParsedEvent,
} from '@baton/shared';

type BunWebSocket = import('bun').ServerWebSocket<{ clientId: string }>;

interface Client {
  id: string;
  ws: BunWebSocket;
  subscriptions: Set<string>;
}

const OPEN = 1;

export class Transport {
  private server: ReturnType<typeof Bun.serve<{ clientId: string }>> | null = null;
  private clients = new Map<string, Client>();
  private registeredSessions = new Set<string>();
  private sessionUnsubs = new Map<string, { unsubRaw: () => void; unsubEvent: () => void }>();

  constructor(
    private agentManager: AgentManager,
    private port: number,
  ) {}

  start(): void {
    const clients = this.clients;
    const self = this;

    const hostname = process.env.HOST || '0.0.0.0';

    this.server = Bun.serve<{ clientId: string }>({
      fetch(req, server) {
        if (server.upgrade(req, { data: { clientId: '' } })) {
          return;
        }
        return new Response('WebSocket expected', { status: 400 });
      },
      websocket: {
        open(ws: import('bun').ServerWebSocket<{ clientId: string }>) {
          const clientId = crypto.randomUUID();
          ws.data = { clientId };
          const client: Client = { id: clientId, ws, subscriptions: new Set() };
          clients.set(clientId, client);
          self.sendAgentList(clientId);
        },
        message(ws: import('bun').ServerWebSocket<{ clientId: string }>, message: string | Buffer) {
          const clientId = ws.data.clientId;
          try {
            const msg = JSON.parse(message.toString()) as ClientMessage;
            self.handleMessage(clientId, msg);
          } catch {
            self.send(clientId, { type: 'error', message: 'Invalid message format' });
          }
        },
        close(ws: import('bun').ServerWebSocket<{ clientId: string }>) {
          clients.delete(ws.data.clientId);
        },
      },
      hostname,
      port: this.port + 1,
    });

    console.log(`WebSocket server listening on ws://localhost:${this.port + 1}`);
  }

  private handleMessage(clientId: string, msg: ClientMessage): void {
    switch (msg.type) {
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
        console.log(`[baton] transport: chat_input session=${msg.sessionId.slice(0,8)} content="${msg.content.slice(0, 60)}" model=${msg.model ?? 'default'}`);
        try {
          if (msg.model) this.agentManager.setModel(msg.sessionId, msg.model);
          this.agentManager.chatWrite(msg.sessionId, msg.content);
          console.log('[baton] transport: chatWrite succeeded');
        } catch (err) {
          const msg_err = err instanceof Error ? err.message : `Session ${msg.sessionId} not found`;
          console.error('[baton] transport: chatWrite error:', msg_err);
          this.send(clientId, { type: 'error', message: msg_err });
        }
        break;
      }

      case 'steer_input': {
        try {
          this.agentManager.steer(msg.sessionId, msg.content);
        } catch (err) {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : `Session ${msg.sessionId} not found`,
          });
        }
        break;
      }

      case 'cancel_turn': {
        this.agentManager.cancelTurn(msg.sessionId).catch((err) => {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : `Cancel failed for ${msg.sessionId}`,
          });
        });
        break;
      }

      case 'approve_input': {
        this.agentManager.approve(msg.sessionId, msg.reason).catch((err) => {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : `Approve failed for ${msg.sessionId}`,
          });
        });
        break;
      }

      case 'reject_input': {
        this.agentManager.reject(msg.sessionId, msg.reason).catch((err) => {
          this.send(clientId, {
            type: 'error',
            message: err instanceof Error ? err.message : `Reject failed for ${msg.sessionId}`,
          });
        });
        break;
      }

      case 'model_list_request': {
        this.agentManager.listModels(msg.sessionId).then((models) => {
          const selected = this.agentManager.getSelectedModel(msg.sessionId);
          this.send(clientId, { type: 'model_list', sessionId: msg.sessionId, models, selected });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to list models' });
        });
        break;
      }

      case 'model_select': {
        this.agentManager.setModel(msg.sessionId, msg.model);
        break;
      }

      case 'reasoning_effort_select': {
        try {
          this.agentManager.setReasoningEffort(msg.sessionId, msg.effort);
        } catch (err) {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to set reasoning effort' });
        }
        break;
      }

      case 'access_mode_select': {
        try {
          this.agentManager.setAccessMode(msg.sessionId, msg.mode);
        } catch (err) {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to set access mode' });
        }
        break;
      }

      case 'service_tier_select': {
        try {
          this.agentManager.setServiceTier(msg.sessionId, msg.tier);
        } catch (err) {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to set service tier' });
        }
        break;
      }

      case 'git_branch_list_request': {
        this.agentManager.listGitBranches(msg.sessionId).then((result) => {
          this.send(clientId, { type: 'git_branch_list', sessionId: msg.sessionId, ...result });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to list git branches' });
        });
        break;
      }

      case 'git_branch_select': {
        try {
          this.agentManager.gitCheckout(msg.sessionId, msg.branch).then((result) => {
            this.send(clientId, { type: 'git_result', sessionId: msg.sessionId, operation: 'checkout', ...result });
          });
        } catch (err) {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to switch branch' });
        }
        break;
      }

      case 'git_status_request': {
        Promise.all([
          this.agentManager.gitStatus(msg.sessionId),
          this.agentManager.gitDiff(msg.sessionId),
        ]).then(([status, diff]) => {
          const projectPath = this.agentManager.getProjectPath(msg.sessionId);
          this.send(clientId, { type: 'git_status', sessionId: msg.sessionId, status, diff, projectPath });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Failed to get git status' });
        });
        break;
      }

      case 'git_commit': {
        this.agentManager.gitCommit(msg.sessionId, msg.message).then((result) => {
          this.send(clientId, { type: 'git_result', sessionId: msg.sessionId, operation: 'commit', ...result });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Commit failed' });
        });
        break;
      }

      case 'git_push': {
        this.agentManager.gitPush(msg.sessionId).then((result) => {
          this.send(clientId, { type: 'git_result', sessionId: msg.sessionId, operation: 'push', ...result });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
        });
        break;
      }

      case 'git_pull': {
        this.agentManager.gitPull(msg.sessionId).then((result) => {
          this.send(clientId, { type: 'git_result', sessionId: msg.sessionId, operation: 'pull', ...result });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Pull failed' });
        });
        break;
      }

      case 'git_create_branch': {
        this.agentManager.gitCreateBranch(msg.sessionId, msg.name).then((result) => {
          this.send(clientId, { type: 'git_result', sessionId: msg.sessionId, operation: 'create_branch', ...result });
        }).catch((err) => {
          this.send(clientId, { type: 'error', message: err instanceof Error ? err.message : 'Branch creation failed' });
        });
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
          this.broadcast({
            type: 'status_update',
            sessionId: msg.sessionId,
            status: 'stopped',
          });
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

        try {
          const proc = this.agentManager.get(msg.sessionId);
          const currentStatus = proc?.status;

          const history = this.agentManager.getOutputHistory(msg.sessionId);
          for (const data of history) {
            this.send(clientId, {
              type: 'terminal_output',
              sessionId: msg.sessionId,
              data,
            });
          }

          const events = this.agentManager.getEventHistory(msg.sessionId);
          for (const event of events) {
            if (event.type === 'waiting_approval' && currentStatus !== 'waiting_input') {
              continue;
            }
            this.send(clientId, {
              type: 'parsed_event',
              sessionId: msg.sessionId,
              event,
            });
          }

          if (proc) {
            this.send(clientId, {
              type: 'status_update',
              sessionId: msg.sessionId,
              status: proc.status,
            });
          }
        } catch {
          // Session might not exist
        }
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
    }
  }

  private ensureSessionRegistered(sessionId: string): void {
    if (this.registeredSessions.has(sessionId)) return;
    this.registeredSessions.add(sessionId);

    const unsubRaw = this.agentManager.onRaw(sessionId, (data, sid) => {
      const msg: DaemonMessage = { type: 'terminal_output', sessionId: sid, data };
      const payload = JSON.stringify(msg);
      for (const client of this.clients.values()) {
        if (client.subscriptions.has(sid) && client.ws.readyState === OPEN) {
          client.ws.send(payload);
        }
      }
    });

    const unsubEvent = this.agentManager.onEvent(sessionId, (event: ParsedEvent, sid) => {
      const msg: DaemonMessage = { type: 'parsed_event', sessionId: sid, event };
      const payload = JSON.stringify(msg);
      let sent = 0;
      for (const client of this.clients.values()) {
        if (client.subscriptions.has(sid) && client.ws.readyState === OPEN) {
          client.ws.send(payload);
          sent++;
        }
      }
      if (event.type === 'chat_message' || event.type === 'raw_output') {
        const contentLen = 'content' in event ? String((event as { content?: string }).content ?? '').length : 0;
        console.log(`[baton] transport: broadcast event=${event.type} session=${sid.slice(0,8)} sent_to=${sent} clients contentLen=${contentLen}`);
      }

      if (event.type === 'status_change') {
        const statusMsg: DaemonMessage = {
          type: 'status_update',
          sessionId: sid,
          status: event.status,
        };
        this.broadcast(statusMsg);
      }
    });

    this.sessionUnsubs.set(sessionId, { unsubRaw, unsubEvent });
  }

  registerSessionEvents(sessionId: string): void {
    this.ensureSessionRegistered(sessionId);
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
      })),
    });
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
  }

  stop(): void {
    for (const { unsubRaw, unsubEvent } of this.sessionUnsubs.values()) {
      unsubRaw();
      unsubEvent();
    }
    this.sessionUnsubs.clear();
    this.registeredSessions.clear();
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.server?.stop();
  }
}
