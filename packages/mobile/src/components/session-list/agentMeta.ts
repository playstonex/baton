import { canonicalAgentType, type SessionBucket } from '@baton/shared/utils';
import { Colors } from '../../constants/theme';

export interface AgentMeta {
  label: string;
  icon: string;
  color: string;
}

const AGENT_META: Record<string, AgentMeta> = {
  'claude-code': { label: 'Claude Code', icon: 'sparkles', color: '#D97757' },
  codex: { label: 'Codex', icon: 'terminal', color: '#10A37F' },
  opencode: { label: 'OpenCode', icon: 'code-slash', color: '#6366F1' },
  kiro: { label: 'Kiro', icon: 'rocket', color: '#FF9900' },
  antigravity: { label: 'Antigravity', icon: 'planet-outline', color: '#4285F4' },
  pi: { label: 'Pi', icon: 'flask-outline', color: '#8B5CF6' },
  acp: { label: 'ACP', icon: 'extension-puzzle-outline', color: '#14B8A6' },
  replay: { label: 'Replay', icon: 'play-back-outline', color: '#94A3B8' },
  custom: { label: 'Custom', icon: 'cube-outline', color: '#94A3B8' },
};

export function agentMetaFor(type: string): AgentMeta {
  const canonical = canonicalAgentType(type);
  return AGENT_META[canonical] ?? { label: canonical, icon: 'cube-outline', color: '#94A3B8' };
}

export const BUCKET_COLOR: Record<SessionBucket, string> = {
  needs_input: Colors.warning[400],
  failed: Colors.danger[400],
  running: Colors.primary[500],
  idle: Colors.success[400],
  done: Colors.surface[300],
};
