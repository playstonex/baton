import os from 'node:os';
import { execSync } from 'node:child_process';
import type { SystemStats } from '@baton/shared/types';
import type { AgentManager } from '../agent/manager.js';

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

function getSessionMetrics(agentManager: AgentManager): SystemStats['sessions'] {
  const agents = agentManager.list();
  let totalOutputEntries = 0;
  let totalEventEntries = 0;

  const active = agents.filter((a) => a.status !== 'stopped').length;
  const stopped = agents.length - active;

  for (const agent of agents) {
    try {
      totalOutputEntries += agentManager.getOutputHistory(agent.id).length;
      totalEventEntries += agentManager.getEventHistory(agent.id).length;
    } catch {
    }
  }

  // Rough estimate: ~1KB per output entry, ~0.5KB per event entry
  const estimatedMemoryMB = Math.round((totalOutputEntries * 1 + totalEventEntries * 0.5) / 1024);

  return {
    active,
    stopped,
    totalOutputEntries,
    totalEventEntries,
    estimatedMemoryMB,
  };
}

export async function collectSystemStats(agentManager?: AgentManager): Promise<SystemStats> {
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
    sessions: agentManager ? getSessionMetrics(agentManager) : {
      active: 0,
      stopped: 0,
      totalOutputEntries: 0,
      totalEventEntries: 0,
      estimatedMemoryMB: 0,
    },
  };
}
