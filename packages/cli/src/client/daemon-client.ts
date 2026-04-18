import WebSocket from 'ws';
import { WS_URL } from '../client/api.js';

export class DaemonWsClient {
  private ws: WebSocket | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
    });
  }

  send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.ws?.on('message', (raw) => {
      try {
        handler(JSON.parse(raw.toString()));
      } catch {
        /* ignore */
      }
    });
  }

  onClose(handler: () => void): void {
    this.ws?.on('close', handler);
  }

  close(): void {
    this.ws?.close();
  }
}
