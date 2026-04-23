import { WS_URL } from '../client/api.js';

export class DaemonWsClient {
  private ws: WebSocket | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
  }

  send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.ws!.onmessage = (e) => {
      try {
        handler(JSON.parse(e.data as string));
      } catch {
        /* ignore */
      }
    };
  }

  onClose(handler: () => void): void {
    this.ws!.onclose = handler;
  }

  close(): void {
    this.ws?.close();
  }
}
