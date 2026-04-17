import { WebSocketServer, WebSocket } from 'ws';
import type { AgentManager } from '../agent/manager.js';
import type {
  ClientMessage,
  DaemonMessage,
  ParsedEvent,
} from '@flowwhips/shared';

interface Client {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>; // session IDs this client is watching
}

export class Transport {
  private wss: WebSocketServer;
  private clients = new Map<string, Client>();
  private registeredSessions = new Set<string>();

  constructor(
    private agentManager: AgentManager,
    private port: number,
  ) {
    this.wss = new WebSocketServer({ port: this.port + 1 });
  }

  start(): void {
    this.wss.on('connection', (ws) => {
      const clientId = crypto.randomUUID();
      const client: Client = { id: clientId, ws, subscriptions: new Set() };
      this.clients.set(clientId, client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          this.handleMessage(clientId, msg);
        } catch {
          this.send(clientId, { type: 'error', message: 'Invalid message format' });
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
      });

      // Send agent list on connect
      this.sendAgentList(clientId);
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

        client.subscriptions.add(msg.sessionId);
        this.ensureSessionRegistered(msg.sessionId);

        // Replay output history for reconnection
        try {
          const history = this.agentManager.getOutputHistory(msg.sessionId);
          for (const data of history) {
            this.send(clientId, {
              type: 'terminal_output',
              sessionId: msg.sessionId,
              data,
            });
          }

          // Replay event history
          const events = this.agentManager.getEventHistory(msg.sessionId);
          for (const event of events) {
            this.send(clientId, {
              type: 'parsed_event',
              sessionId: msg.sessionId,
              event,
            });
          }

          // Send current status
          const proc = this.agentManager.get(msg.sessionId);
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

    // Wire up raw terminal output
    this.agentManager.onRaw(sessionId, (data, sid) => {
      const msg: DaemonMessage = { type: 'terminal_output', sessionId: sid, data };
      const payload = JSON.stringify(msg);
      for (const client of this.clients.values()) {
        if (client.subscriptions.has(sid) && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    });

    // Wire up structured events
    this.agentManager.onEvent(sessionId, (event: ParsedEvent, sid) => {
      const msg: DaemonMessage = { type: 'parsed_event', sessionId: sid, event };
      const payload = JSON.stringify(msg);
      for (const client of this.clients.values()) {
        if (client.subscriptions.has(sid) && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }

      // Broadcast status changes to all clients (not just subscribers)
      if (event.type === 'status_change') {
        const statusMsg: DaemonMessage = {
          type: 'status_update',
          sessionId: sid,
          status: event.status,
        };
        this.broadcast(statusMsg);
      }
    });
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
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: DaemonMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  stop(): void {
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.wss.close();
  }
}
