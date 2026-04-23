import os from 'node:os';
import { execSync } from 'node:child_process';
import type { SystemStats } from '@flowwhips/shared/types';

function getDiskUsage(): { used: number; total: number; percentage: number } {
  try {
    const output = execSync('df -k /', { encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    const parts = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
    const total = Number(parts[1] ?? 0) * 1024;
    const used = Number(parts[2] ?? 0) * 1024;
    return {
      used,
      total,
      percentage: total > 0 ? (used / total) * 100 : 0,
    };
  } catch {
    return { used: 0, total: 0, percentage: 0 };
  }
}

export async function collectSystemStats(): Promise<SystemStats> {
  const cores = os.cpus().length;
  const loadAvg = os.loadavg();
  const total = os.totalmem();
  const used = total - os.freemem();
  const disk = getDiskUsage();

  return {
    cpu: {
      cores,
      usage: cores > 0 ? loadAvg[0] / cores : 0,
    },
    memory: {
      used,
      total,
      percentage: total > 0 ? (used / total) * 100 : 0,
    },
    disk,
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: process.platform,
    loadAvg,
  };
}
