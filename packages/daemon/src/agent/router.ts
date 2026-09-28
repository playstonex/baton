import type { AgentConfig, AgentType } from '@baton/shared';
import type { BaseAgentAdapter } from '../agent/adapter.js';
import { createAdapter } from '../agent/index.js';

interface RouteRule {
  pattern: string;
  provider: AgentType;
  priority: number;
}

interface RoutingDecision {
  provider: AgentType;
  adapter: BaseAgentAdapter;
  matchedRule?: string;
}

export class ProviderRouter {
  private rules: RouteRule[] = [];
  private fallback: AgentType = 'claude-code';

  constructor() {
    this.loadDefaults();
  }

  private loadDefaults(): void {
    this.rules = [
      { pattern: '*:code-review', provider: 'claude-code', priority: 10 },
      { pattern: '*:refactor', provider: 'claude-code', priority: 10 },
      { pattern: '*:test', provider: 'codex', priority: 10 },
      { pattern: '*:debug', provider: 'claude-code', priority: 5 },
      { pattern: '*:docs', provider: 'opencode', priority: 5 },
    ];
  }

  addRule(pattern: string, provider: AgentType, priority = 0): void {
    this.rules.push({ pattern, provider, priority });
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  setFallback(provider: AgentType): void {
    this.fallback = provider;
  }

  route(config: AgentConfig, taskHint?: string): RoutingDecision {
    const matchedRule = taskHint
      ? this.rules.find((r) => {
          const [scope, action] = r.pattern.split(':');
          return (scope === '*' || scope === config.type) && action === taskHint;
        })
      : undefined;

    const provider = matchedRule?.provider ?? this.fallback;
    const adapter = createAdapter(provider, 'pty');

    return {
      provider,
      adapter,
      matchedRule: matchedRule?.pattern,
    };
  }

  listRules(): RouteRule[] {
    return [...this.rules];
  }
}
