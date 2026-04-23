import { randomUUID } from 'node:crypto';
import { MessageBuffer } from './buffer.js';
import { PairingService } from './pairing.js';
import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  generateNonce,
  keyToFingerprint,
} from '@flowwhips/shared/crypto';

const DEFAULT_PORT = 3230;
const OPEN = 1;

type Ws = import('bun').ServerWebSocket<{ id: string }>;

interface HostConnection {
  hostId: string;
  ws: Ws;
  messageBuffer: MessageBuffer;
  lastSeen: number;
  publicKeyFingerprint?: string;
  sharedKey?: Uint8Array;
  publicKey?: Uint8Array;
  encryptionEnabled: boolean;
}

interface ClientConnection {
  clientId: string;
  hostId: string;
  ws: Ws;
  lastSeen: number;
  publicKeyFingerprint?: string;
  sharedKey?: Uint8Array;
  publicKey?: Uint8Array;
  encryptionEnabled: boolean;
}

export class RelayServer {
  private hosts = new Map<string, HostConnection>();
  private clients = new Map<string, ClientConnection>();
  private server: ReturnType<typeof Bun.serve<{ id: string }>> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private pairing = new PairingService();

  constructor(private port = DEFAULT_PORT) {}

  start(): void {
    const self = this;

    this.server = Bun.serve<{ id: string }>({
      fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            hosts: self.hosts.size,
            clients: self.clients.size,
            uptime: process.uptime(),
          });
        }

        if (url.pathname === '/pair' && url.searchParams.has('code')) {
          const code = url.searchParams.get('code')!.toUpperCase();
          const result = self.pairing.redeem(code);
          if (!result) {
            return Response.json({ error: 'Invalid or expired pairing code' }, { status: 404 });
          }
          return Response.json(result);
        }

        if (url.pathname === '/ws' || url.protocol === 'ws:' || req.headers.get('upgrade') === 'websocket') {
          server.upgrade(req, { data: { id: randomUUID() } });
          return new Response(null, { status: 101 });
        }

        return new Response('Not found', { status: 404 });
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ type: 'welcome', message: 'FlowWhips Relay v0.0.1' }));
        },
        message(ws, message) {
          try {
            const msg = JSON.parse(message.toString());
            self.handleMessage(ws, msg);
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
          }
        },
        close(ws) {
          self.handleDisconnect(ws);
        },
      },
      port: this.port,
    });

    console.log(`\n  FlowWhips Relay v0.0.1`);
    console.log(`  WebSocket: ws://localhost:${this.port}`);
    console.log(`  Health:    http://localhost:${this.port}/health\n`);

    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  private handleMessage(ws: Ws, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'encrypted':
        this.handleEncryptedMessage(ws, msg);
        break;
      case 'register':
        this.handleRegister(ws, msg);
        break;
      case 'key_exchange':
        this.handleKeyExchange(ws, msg);
        break;
      case 'pair_request':
        this.handlePairRequest(ws, msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      default:
        this.handleForward(ws, msg);
        break;
    }
  }

  private handleEncryptedMessage(ws: Ws, msg: Record<string, unknown>): void {
    const payload = msg.payload as string;
    if (!payload) {
      ws.send(JSON.stringify({ type: 'error', message: 'payload required' }));
      return;
    }

    const host = this.findHostByWs(ws);
    if (host && host.sharedKey) {
      const decrypted = this.decryptPayload(payload, host.sharedKey);
      if (decrypted) {
        this.handleForward(ws, decrypted);
      }
      return;
    }

    const client = this.findClientByWs(ws);
    if (client && client.sharedKey) {
      const decrypted = this.decryptPayload(payload, client.sharedKey);
      if (decrypted) {
        this.handleForward(ws, decrypted);
      }
    }
  }

  private handleKeyExchange(ws: Ws, msg: Record<string, unknown>): void {
    const peerPublicKeyBase64 = msg.publicKey as string;
    if (!peerPublicKeyBase64) {
      ws.send(JSON.stringify({ type: 'error', message: 'publicKey required' }));
      return;
    }

    const peerPublicKey = Uint8Array.from(atob(peerPublicKeyBase64), (c) => c.charCodeAt(0));
    const myKeyPair = generateKeyPair();
    const sharedKey = deriveSharedKey(peerPublicKey, myKeyPair.secretKey);

    const host = this.findHostByWs(ws);
    const client = this.findClientByWs(ws);

    if (host) {
      host.publicKey = peerPublicKey;
      host.sharedKey = sharedKey;
      host.encryptionEnabled = true;

      ws.send(
        JSON.stringify({
          type: 'key_exchange_done',
          publicKey: btoa(String.fromCharCode(...myKeyPair.publicKey)),
        }),
      );
    } else if (client) {
      client.publicKey = peerPublicKey;
      client.sharedKey = sharedKey;
      client.encryptionEnabled = true;

      ws.send(
        JSON.stringify({
          type: 'key_exchange_done',
          publicKey: btoa(String.fromCharCode(...myKeyPair.publicKey)),
        }),
      );
    }
  }

  private handleRegister(ws: Ws, msg: Record<string, unknown>): void {
    const role = msg.role as string;

    if (role === 'host') {
      const hostId = (msg.hostId as string) || randomUUID();
      const publicKeyFingerprint = msg.publicKeyFingerprint as string | undefined;

      const existing = this.hosts.get(hostId);
      if (existing) {
        existing.ws.close(1001, 'Replaced by new connection');
      }

      this.hosts.set(hostId, {
        hostId,
        ws,
        messageBuffer: existing?.messageBuffer ?? new MessageBuffer(),
        lastSeen: Date.now(),
        publicKeyFingerprint,
        encryptionEnabled: false,
      });

      ws.send(JSON.stringify({ type: 'registered', hostId }));
      console.log(`Host registered: ${hostId}`);

      for (const client of this.clients.values()) {
        if (client.hostId === hostId && client.ws.readyState === OPEN) {
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
      const publicKeyFingerprint = msg.publicKeyFingerprint as string | undefined;

      this.clients.set(clientId, {
        clientId,
        hostId,
        ws,
        lastSeen: Date.now(),
        publicKeyFingerprint,
        encryptionEnabled: false,
      });

      ws.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          hostId,
          hostOnline: this.hosts.has(hostId),
        }),
      );

      console.log(`Client connected: ${clientId} → host ${hostId}`);

      const host = this.hosts.get(hostId);
      if (host) {
        this.flushBufferToClient(host, ws);
      }
    }
  }

  private handlePairRequest(ws: Ws, msg: Record<string, unknown>): void {
    const hostId = msg.hostId as string;
    const host = this.hosts.get(hostId);

    if (!host || host.ws !== ws) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not a registered host' }));
      return;
    }

    const fingerprint = (msg.publicKeyFingerprint as string) || host.publicKeyFingerprint || '';
    const code = this.pairing.createCode(hostId, fingerprint);

    ws.send(
      JSON.stringify({
        type: 'pair_code',
        code,
        expiresIn: 300,
        relayUrl: `ws://localhost:${this.port}`,
      }),
    );
  }

  private encryptPayload(msg: Record<string, unknown>, sharedKey: Uint8Array): string {
    const plaintext = new TextEncoder().encode(JSON.stringify(msg));
    const nonce = generateNonce();
    const ciphertext = encrypt(plaintext, nonce, sharedKey);
    const payload = new Uint8Array(nonce.length + ciphertext.length);
    payload.set(nonce, 0);
    payload.set(ciphertext, nonce.length);
    return btoa(String.fromCharCode(...payload));
  }

  private decryptPayload(payload: string, sharedKey: Uint8Array): Record<string, unknown> | null {
    try {
      const data = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const nonce = data.slice(0, 24);
      const ciphertext = data.slice(24);
      const plaintext = decrypt(ciphertext, nonce, sharedKey);
      if (!plaintext) return null;
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      return null;
    }
  }

  private handleForward(ws: Ws, msg: Record<string, unknown>): void {
    const host = this.findHostByWs(ws);
    if (host) {
      host.lastSeen = Date.now();
      const payload = JSON.stringify(msg);
      host.messageBuffer.push(payload);

      for (const client of this.clients.values()) {
        if (client.hostId === host.hostId && client.ws.readyState === OPEN) {
          if (host.encryptionEnabled && client.encryptionEnabled && host.sharedKey && client.sharedKey) {
            const encrypted = this.encryptPayload(msg, host.sharedKey);
            client.ws.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
          } else {
            client.ws.send(payload);
          }
        }
      }
      return;
    }

    const client = this.findClientByWs(ws);
    if (client) {
      client.lastSeen = Date.now();
      const hostConn = this.hosts.get(client.hostId);

      if (hostConn?.ws.readyState === OPEN) {
        if (client.encryptionEnabled && hostConn.encryptionEnabled && client.sharedKey && hostConn.sharedKey) {
          const encrypted = this.encryptPayload(msg, client.sharedKey);
          hostConn.ws.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
        } else {
          hostConn.ws.send(JSON.stringify(msg));
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Host is offline' }));
      }
    }
  }

  private flushBufferToClient(host: HostConnection, clientWs: Ws): void {
    const recent = host.messageBuffer.recent();
    for (const msg of recent) {
      if (clientWs.readyState === OPEN) {
        const parsed = JSON.parse(msg.data);
        if (host.encryptionEnabled && clientWs.encryptionEnabled && host.sharedKey) {
          const encrypted = this.encryptPayload(parsed, host.sharedKey);
          clientWs.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
        } else {
          clientWs.send(msg.data);
        }
      }
    }
  }

  private handleDisconnect(ws: Ws): void {
    for (const [hostId, host] of this.hosts) {
      if (host.ws === ws) {
        console.log(`Host disconnected: ${hostId}`);
        this.hosts.delete(hostId);

        for (const client of this.clients.values()) {
          if (client.hostId === hostId && client.ws.readyState === OPEN) {
            client.ws.send(JSON.stringify({ type: 'host_disconnected', hostId }));
          }
        }
        return;
      }
    }

    for (const [clientId, client] of this.clients) {
      if (client.ws === ws) {
        console.log(`Client disconnected: ${clientId}`);
        this.clients.delete(clientId);

        const hostConn = this.hosts.get(client.hostId);
        if (hostConn) {
          console.log(
            `Host ${client.hostId} retained (encryption: ${hostConn.encryptionEnabled}, key: ${hostConn.sharedKey ? 'yes' : 'no'})`,
          );
        }
        return;
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const TTL = 10 * 60 * 1000;

    for (const [clientId, client] of this.clients) {
      if (now - client.lastSeen > TTL) {
        this.clients.delete(clientId);
      }
    }

    for (const host of this.hosts.values()) {
      host.messageBuffer.cleanup();
    }
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const client of this.clients.values()) client.ws.close(1001, 'Shutting down');
    for (const host of this.hosts.values()) host.ws.close(1001, 'Shutting down');
    this.server?.stop();
  }

  private findHostByWs(ws: Ws): HostConnection | undefined {
    for (const host of this.hosts.values()) {
      if (host.ws === ws) return host;
    }
    return undefined;
  }

  private findClientByWs(ws: Ws): ClientConnection | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) return client;
    }
    return undefined;
  }
}

const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
new RelayServer(port).start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
