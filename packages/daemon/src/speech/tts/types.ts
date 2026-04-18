export interface TtsResult {
  audio: Buffer;
  timestamp: number;
}

export interface TtsEngine {
  synthesize(text: string): Promise<TtsResult>;
  synthesizeStream(text: string): AsyncIterable<TtsResult>;
}
