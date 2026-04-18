declare module 'sherpa-onnx-node' {
  export function createOfflineRecognizer(config: Record<string, unknown>): {
    decode(buffer: Buffer): string;
  };
  export function createOfflineTts(config: Record<string, unknown>): {
    generate(text: string): { samples: Float32Array };
  };
}

declare module '@deepgram/sdk' {
  export function createClient(apiKey: string): {
    listen: {
      live(config: Record<string, unknown>): {
        on(event: string, cb: (data: Record<string, unknown>) => void): void;
        send(buffer: Buffer): void;
        finish(): void;
      };
    };
  };
}

declare module 'openai' {
  export default class OpenAI {
    constructor(config: { apiKey: string });
    audio: {
      speech: {
        create(config: Record<string, unknown>): Promise<{
          arrayBuffer(): Promise<ArrayBuffer>;
        }>;
      };
    };
  }
}
