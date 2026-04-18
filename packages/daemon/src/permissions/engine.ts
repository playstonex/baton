export interface PermissionRule {
  agent: string;
  action: 'allow' | 'deny';
  resources: string[];
  tools?: string[];
}

export interface PermissionCheck {
  agentId: string;
  tool: string;
  resource: string;
}

export class PermissionEngine {
  private rules: PermissionRule[] = [];

  loadRules(rules: PermissionRule[]): void {
    this.rules = rules;
  }

  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  check(check: PermissionCheck): boolean {
    for (const rule of this.rules) {
      if (rule.agent !== '*' && rule.agent !== check.agentId) continue;

      const resourceMatch = rule.resources.some((r) => {
        if (r === '*') return true;
        return check.resource.startsWith(r);
      });

      if (!resourceMatch) continue;

      const toolMatch = !rule.tools || rule.tools.length === 0 || rule.tools.includes(check.tool);
      if (!toolMatch) continue;

      return rule.action === 'allow';
    }

    return false;
  }

  listRules(): PermissionRule[] {
    return [...this.rules];
  }
}
