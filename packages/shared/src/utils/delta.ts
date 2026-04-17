// Delta compression for terminal output

export class DeltaCompressor {
  private lastSent = new Map<string, string>(); // sessionId → last full output

  // Compress: if output is similar to last, send only the diff tail
  compress(sessionId: string, data: string): string {
    const last = this.lastSent.get(sessionId) ?? '';

    // If data starts with last (appended content), just send the new part
    if (last && data.startsWith(last)) {
      const delta = data.slice(last.length);
      this.lastSent.set(sessionId, data);
      return delta;
    }

    // Otherwise, send full
    this.lastSent.set(sessionId, data);
    return data;
  }

  // For individual terminal chunks, just pass through (compression is for replay buffer)
  compressChunk(_sessionId: string, chunk: string): string {
    return chunk;
  }

  reset(sessionId: string): void {
    this.lastSent.delete(sessionId);
  }
}
