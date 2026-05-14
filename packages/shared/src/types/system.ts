export interface SystemStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  uptime: number;
  hostname: string;
  platform: string;
  loadAvg: number[];
  sessions: {
    active: number;
    stopped: number;
    totalOutputEntries: number;
    totalEventEntries: number;
    estimatedMemoryMB: number;
  };
}
