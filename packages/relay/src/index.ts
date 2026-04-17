import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const DEFAULT_PORT = 3230;

interface HostConnection {
  hostId: string;
  ws: WebSocket;
  messageBuffer: BufferedMessage[];
  lastSeen: number;
}

interface ClientConnection {
  clientId: string;
  hostId: string;
  ws: WebSocket;
  lastSeen: number;
}

interface BufferedMessage {
  id: string;
  data: string;
  timestamp: number;
}

const MAX_BUFFER_SIZE = 5000; // ~5000 messages buffered per host
const BUFFER_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class RelayServer {
  private hosts = new Map<string, HostConnection>();
  private clients = new Map<string, ClientConnection>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private port = DEFAULT_PORT) {}

  start(): void {
    this.httpServer = createServer((req, res) => {
      // Health check + status endpoint
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            hosts: this.hosts.size,
            clients: this.clients.size,
            uptime: process.uptime(),
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
        }
      });

      ws.on('close', () => this.handleDisconnect(ws));
      ws.on('error', () => this.handleDisconnect(ws));

      // Send welcome
      ws.send(JSON.stringify({ type: 'welcome', message: 'FlowWhips Relay' }));
    });

    this.httpServer.listen(this.port, () => {
      console.log(`\n  FlowWhips Relay v0.0.1`);
      console.log(`  WebSocket: ws://localhost:${this.port}`);
      console.log(`  Health:    http://localhost:${this.port}/health\n`);
    });

    // Periodic cleanup of stale connections and old buffered messages
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  private handleMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'register':
        this.handleRegister(ws, msg);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        this.handleForward(ws, msg);
        break;
    }
  }

  private handleRegister(ws: WebSocket, msg: Record<string, unknown>): void {
    const role = msg.role as string;

    if (role === 'host') {
      const hostId = (msg.hostId as string) || randomUUID();

      // If host reconnects, replace old connection and flush buffer
      const existing = this.hosts.get(hostId);
      if (existing) {
        existing.ws.close(1001, 'Replaced by new connection');
      }

      this.hosts.set(hostId, {
        hostId,
        ws,
        messageBuffer: existing?.messageBuffer ?? [],
        lastSeen: Date.now(),
      });

      ws.send(JSON.stringify({ type: 'registered', hostId }));
      console.log(`Host registered: ${hostId}`);

      // Notify waiting clients
      for (const client of this.clients.values()) {
        if (client.hostId === hostId && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'host_online', hostId }));
        }
      }
    } else if (role === 'client') {
      const hostId = msg.hostId as string;
      if (!hostId) {
        ws.send(JSON.stringify({ type: 'error', message: 'hostId required' }));
        return;
      }

      const clientId = randomUUID();

      this.clients.set(clientId, {
        clientId,
        hostId,
        ws,
        lastSeen: Date.now(),
      });

      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        hostId,
        hostOnline: this.hosts.has(hostId),
      }));

      console.log(`Client connected: ${clientId} → host ${hostId}`);

      // If host is online, replay buffered messages to this client
      const host = this.hosts.get(hostId);
      if (host) {
        this.flushBufferToClient(host, ws);
      }
    }
  }

  private handleForward(ws: WebSocket, msg: Record<string, unknown>): void {
    // Forward from host → clients
    const host = this.findHostByWs(ws);
    if (host) {
      host.lastSeen = Date.now();

      const payload = JSON.stringify(msg);

      // Buffer for offline/reconnecting clients
      host.messageBuffer.push({
        id: randomUUID(),
        data: payload,
        timestamp: Date.now(),
      });
      if (host.messageBuffer.length > MAX_BUFFER_SIZE) {
        host.messageBuffer = host.messageBuffer.slice(-Math.floor(MAX_BUFFER_SIZE / 2));
      }

      // Forward to all bound clients
      for (const client of this.clients.values()) {
        if (client.hostId === host.hostId && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
      return;
    }

    // Forward from client → host
    const client = this.findClientByWs(ws);
    if (client) {
      client.lastSeen = Date.now();
      const hostConn = this.hosts.get(client.hostId);
      if (hostConn?.ws.readyState === WebSocket.OPEN) {
        hostConn.ws.send(JSON.stringify(msg));
      } else {
        // Host offline — notify client
        ws.send(JSON.stringify({ type: 'error', message: 'Host is offline' }));
      }
    }
  }

  private flushBufferToClient(host: HostConnection, clientWs: WebSocket): void {
    const now = Date.now();
    const recent = host.messageBuffer.filter((m) => now - m.timestamp < BUFFER_TTL_MS);
    for (const msg of recent) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(msg.data);
      }
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    // Check if it's a host
    for (const [hostId, host] of this.hosts) {
      if (host.ws === ws) {
        console.log(`Host disconnected: ${hostId}`);
        // Don't delete immediately — keep buffer for reconnection
        // Just close the WS reference
        this.hosts.delete(hostId);

        // Notify clients
        for (const client of this.clients.values()) {
          if (client.hostId === hostId && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'host_disconnected', hostId }));
          }
        }
        return;
      }
    }

    // Check if it's a client
    for (const [clientId, client] of this.clients) {
      if (client.ws === ws) {
        console.log(`Client disconnected: ${clientId}`);
        this.clients.delete(clientId);
        return;
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();

    // Clean stale connections
    for (const [clientId, client] of this.clients) {
      if (now - client.lastSeen > BUFFER_TTL_MS) {
        this.clients.delete(clientId);
      }
    }

    // Clean old buffered messages
    for (const host of this.hosts.values()) {
      host.messageBuffer = host.messageBuffer.filter((m) => now - m.timestamp < BUFFER_TTL_MS);
    }
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const client of this.clients.values()) client.ws.close(1001, 'Shutting down');
    for (const host of this.hosts.values()) host.ws.close(1001, 'Shutting down');
    this.wss?.close();
    if (this.httpServer) await new Promise((r) => this.httpServer!.close(r));
  }

  private findHostByWs(ws: WebSocket): HostConnection | undefined {
    for (const host of this.hosts.values()) {
      if (host.ws === ws) return host;
    }
    return undefined;
  }

  private findClientByWs(ws: WebSocket): ClientConnection | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) return client;
    }
    return undefined;
  }
}

// Run if called directly
const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
new RelayServer(port).start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
