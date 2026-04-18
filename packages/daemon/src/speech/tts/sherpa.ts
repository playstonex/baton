import type { TtsEngine, TtsResult } from './types.js';

export class SherpaTtsEngine implements TtsEngine {
  constructor(private modelDir: string) {}

  async synthesize(text: string): Promise<TtsResult> {
    try {
      const sherpa = await import('sherpa-onnx-node');
      const tts = sherpa.createOfflineTts({
        modelConfig: {
          vits: { model: `${this.modelDir}/model.onnx`, tokens: `${this.modelDir}/tokens.txt` },
        },
      });
      const audio = tts.generate(text);
      return { audio: Buffer.from(audio.samples.buffer), timestamp: Date.now() };
    } catch (err) {
      throw new Error(`Sherpa TTS failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async *synthesizeStream(text: string): AsyncIterable<TtsResult> {
    const result = await this.synthesize(text);
    yield result;
  }
}
