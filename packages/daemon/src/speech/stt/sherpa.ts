import type { SttEngine, SttResult } from './types.js';

export class SherpaSttEngine implements SttEngine {
  private active = false;

  constructor(private modelPath: string) {}

  async *start(audioStream: AsyncIterable<Buffer>): AsyncIterable<SttResult> {
    this.active = true;
    try {
      const sherpa = await import('sherpa-onnx-node');
      const recognizer = sherpa.createOfflineRecognizer({
        modelConfig: {
          transducer: { encoder: '', decoder: '', joiner: '' },
          paraformer: { model: this.modelPath },
          featConfig: { sampleRate: 16000, featureDim: 80 },
        },
      });

      for await (const chunk of audioStream) {
        if (!this.active) break;
        const result = recognizer.decode(chunk);
        if (result) {
          yield {
            text: result,
            confidence: 1.0,
            isFinal: true,
            timestamp: Date.now(),
          };
        }
      }
    } catch (err) {
      throw new Error(`Sherpa STT failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.active = false;
  }
}
