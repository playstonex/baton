import type { SttEngine, SttResult } from './types.js';

export class DeepgramSttEngine implements SttEngine {
  private active = false;

  constructor(
    private apiKey: string,
    private model = 'nova-3',
  ) {}

  async *start(audioStream: AsyncIterable<Buffer>): AsyncIterable<SttResult> {
    this.active = true;
    try {
      const { createClient } = await import('@deepgram/sdk');
      const deepgram = createClient(this.apiKey);
      const connection = deepgram.listen.live({
        model: this.model,
        encoding: 'linear16',
        sample_rate: 16000,
      });

      const results: SttResult[] = [];
      const resultReady: (() => void)[] = [];

      connection.on(
        'transcript',
        (data: {
          channel?: { alternatives?: Array<{ transcript: string; confidence: number }> };
          is_final?: boolean;
        }) => {
          const alt = data.channel?.alternatives?.[0];
          if (alt?.transcript) {
            const result: SttResult = {
              text: alt.transcript,
              confidence: alt.confidence,
              isFinal: data.is_final ?? false,
              timestamp: Date.now(),
            };
            results.push(result);
            const resolve = resultReady.shift();
            resolve?.();
          }
        },
      );

      for await (const chunk of audioStream) {
        if (!this.active) break;
        connection.send(chunk);
        while (results.length > 0) {
          yield results.shift()!;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      while (results.length > 0) {
        yield results.shift()!;
      }

      connection.finish();
    } catch (err) {
      throw new Error(`Deepgram STT failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.active = false;
  }
}
