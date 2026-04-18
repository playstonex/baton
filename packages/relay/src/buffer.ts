export interface BufferedMessage {
  id: string;
  data: string;
  timestamp: number;
}

export class MessageBuffer {
  private messages: BufferedMessage[] = [];

  constructor(
    private maxSize = 5000,
    private ttlMs = 10 * 60 * 1000,
  ) {}

  push(data: string): void {
    this.messages.push({
      id: crypto.randomUUID(),
      data,
      timestamp: Date.now(),
    });
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-Math.floor(this.maxSize / 2));
    }
  }

  flush(): BufferedMessage[] {
    const now = Date.now();
    const recent = this.messages.filter((m) => now - m.timestamp < this.ttlMs);
    this.messages = [];
    return recent;
  }

  recent(): BufferedMessage[] {
    const now = Date.now();
    return this.messages.filter((m) => now - m.timestamp < this.ttlMs);
  }

  cleanup(): void {
    const now = Date.now();
    this.messages = this.messages.filter((m) => now - m.timestamp < this.ttlMs);
  }

  get length(): number {
    return this.messages.length;
  }
}
