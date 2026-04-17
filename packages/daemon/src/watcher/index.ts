import { watch } from 'chokidar';
import type { ParsedEvent } from '@flowwhips/shared';

export interface FileWatcherOptions {
  projectPath: string;
  debounceMs?: number;
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/.turbo/**',
  '**/*.pyc',
  '**/__pycache__/**',
  '**/.DS_Store',
  '**/.env*',
];

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private callbacks = new Set<(event: ParsedEvent) => void>();
  private pendingChanges = new Map<string, ParsedEvent>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  constructor(private options: FileWatcherOptions) {
    this.debounceMs = options.debounceMs ?? 300;
  }

  start(): void {
    const ignore = [...DEFAULT_IGNORE, ...(this.options.ignorePatterns ?? [])];

    this.watcher = watch(this.options.projectPath, {
      ignored: ignore,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (path) => this.handleChange(path, 'create'));
    this.watcher.on('change', (path) => this.handleChange(path, 'modify'));
    this.watcher.on('unlink', (path) => this.handleChange(path, 'delete'));

    this.watcher.on('error', (error) => {
      console.error('FileWatcher error:', error);
    });
  }

  private handleChange(filePath: string, changeType: 'create' | 'modify' | 'delete'): void {
    const event: ParsedEvent = {
      type: 'file_change',
      path: filePath,
      changeType,
      timestamp: Date.now(),
    };

    this.pendingChanges.set(filePath, event);

    // Debounce: batch rapid changes
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushChanges();
    }, this.debounceMs);
  }

  private flushChanges(): void {
    for (const event of this.pendingChanges.values()) {
      for (const cb of this.callbacks) {
        cb(event);
      }
    }
    this.pendingChanges.clear();
    this.debounceTimer = null;
  }

  onFileChange(callback: (event: ParsedEvent) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.flushChanges();
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
