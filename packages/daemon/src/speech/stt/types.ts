export interface SttResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface SttEngine {
  start(audioStream: AsyncIterable<Buffer>): AsyncIterable<SttResult>;
  stop(): void;
}
