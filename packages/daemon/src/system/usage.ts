import type { ModelUsageReport, UsageWindow } from '@baton/shared';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const USAGE_CACHE_TTL_MS = 60_000;

interface CachedReport {
  report: ModelUsageReport;
  cachedAt: number;
}

let cachedUsage: CachedReport | null = null;

interface ClaudeTokenData {
  accessToken: string;
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Attempts to retrieve the Claude Code OAuth access token.
 * 1. Checks macOS Keychain for 'Claude Code-credentials'
 * 2. Checks ~/.claude/.credentials.json
 * 3. Checks ~/.claude.json
 */
async function getClaudeOAuthToken(): Promise<ClaudeTokenData | null> {
  const home = homedir();

  // 1. macOS Keychain
  if (platform() === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'],
        { timeout: 3000, encoding: 'utf-8' },
      );
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        const oauth = parsed?.claudeAiOauth ?? parsed;
        if (oauth?.accessToken) {
          return {
            accessToken: oauth.accessToken,
            subscriptionType: oauth.subscriptionType,
            rateLimitTier: oauth.rateLimitTier,
          };
        }
      }
    } catch {
      // Keychain lookup failed or user denied; proceed to file lookup
    }
  }

  // 2. ~/.claude/.credentials.json
  const credPath = join(home, '.claude', '.credentials.json');
  if (existsSync(credPath)) {
    try {
      const raw = await readFile(credPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const oauth = parsed?.claudeAiOauth ?? parsed;
      if (oauth?.accessToken) {
        return {
          accessToken: oauth.accessToken,
          subscriptionType: oauth.subscriptionType,
          rateLimitTier: oauth.rateLimitTier,
        };
      }
    } catch {
      // ignore
    }
  }

  // 3. ~/.claude.json
  const altPath = join(home, '.claude.json');
  if (existsSync(altPath)) {
    try {
      const raw = await readFile(altPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const oauth = parsed?.claudeAiOauth ?? parsed;
      if (oauth?.accessToken) {
        return {
          accessToken: oauth.accessToken,
          subscriptionType: oauth.subscriptionType,
          rateLimitTier: oauth.rateLimitTier,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Fetches real-time quota & rate limit utilization from Anthropic's OAuth API.
 * Caches responses for 60 seconds to avoid spamming the endpoint.
 */
export async function getModelUsage(forceRefresh = false): Promise<ModelUsageReport> {
  const now = Date.now();
  if (!forceRefresh && cachedUsage && now - cachedUsage.cachedAt < USAGE_CACHE_TTL_MS) {
    return cachedUsage.report;
  }

  const tokenData = await getClaudeOAuthToken();
  if (!tokenData?.accessToken) {
    const fallbackReport: ModelUsageReport = {
      available: false,
      provider: 'claude',
      updatedAt: now,
      reason: 'No Claude OAuth credentials found on this host',
    };
    return fallbackReport;
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        Accept: 'application/json',
        'anthropic-beta': CLAUDE_OAUTH_BETA,
      },
    });

    if (!res.ok) {
      const report: ModelUsageReport = {
        available: false,
        provider: 'claude',
        subscription: tokenData.subscriptionType,
        rateLimitTier: tokenData.rateLimitTier,
        updatedAt: now,
        reason: `Usage API returned HTTP ${res.status}`,
      };
      return report;
    }

    const data = (await res.json()) as {
      five_hour?: { utilization?: number; resets_at?: string };
      seven_day?: { utilization?: number; resets_at?: string };
      seven_day_opus?: { utilization?: number; resets_at?: string };
    };

    const parseWindow = (w?: { utilization?: number; resets_at?: string }): UsageWindow | null => {
      if (!w || typeof w.utilization !== 'number') return null;
      return {
        utilization: Math.round(w.utilization * 100) / 100,
        resetsAt: w.resets_at ?? null,
      };
    };

    const report: ModelUsageReport = {
      available: true,
      provider: 'claude',
      subscription: tokenData.subscriptionType
        ? tokenData.subscriptionType.charAt(0).toUpperCase() + tokenData.subscriptionType.slice(1)
        : 'Claude Pro/Team',
      rateLimitTier: tokenData.rateLimitTier,
      fiveHour: parseWindow(data.five_hour),
      sevenDay: parseWindow(data.seven_day),
      sevenDayOpus: parseWindow(data.seven_day_opus),
      updatedAt: now,
    };

    cachedUsage = { report, cachedAt: now };
    return report;
  } catch (err) {
    return {
      available: false,
      provider: 'claude',
      subscription: tokenData.subscriptionType,
      rateLimitTier: tokenData.rateLimitTier,
      updatedAt: now,
      reason: err instanceof Error ? err.message : 'Failed to query Anthropic usage API',
    };
  }
}
