import type { TtsEngine, TtsResult } from './types.js';

export class OpenAiTtsEngine implements TtsEngine {
  constructor(
    private apiKey: string,
    private voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
    private model = 'tts-1',
  ) {}

  async synthesize(text: string): Promise<TtsResult> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.audio.speech.create({
      model: this.model,
      voice: this.voice,
      input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return { audio: buffer, timestamp: Date.now() };
  }

  async *synthesizeStream(text: string): AsyncIterable<TtsResult> {
    const result = await this.synthesize(text);
    yield result;
  }
}
