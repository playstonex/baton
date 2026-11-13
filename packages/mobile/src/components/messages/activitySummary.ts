import type { ChatMessage, MessageKind } from '../../stores/chat';
import { humanizeCommand } from './CommandHumanizer';

export interface NormalizedActivityStep {
  id: string;
  kind: MessageKind;
  iconName: string;
  accentColor?: string;
  verb: string;
  target?: string;
  status: 'running' | 'completed' | 'failed';
  duration?: string;
  rawContent: string;
  detailType: 'thinking' | 'command' | 'tool' | 'file' | 'subagent';
  command?: string;
  output?: string;
  exitCode?: number;
  filePath?: string;
  diff?: string;
  changeType?: 'create' | 'modify' | 'delete';
  subagentName?: string;
  subagentAction?: string;
}

export interface ActivitySummary {
  title: string;
  totalSteps: number;
  isActive: boolean;
  hasError: boolean;
  durationMs: number;
  formattedDuration: string;
  pills: string[];
  hasFileChanges: boolean;
  fileChangesCount: number;
  activeStepIndex: number;
}

export function formatActivityDuration(ms: number): string {
  if (ms <= 0) return '';
  if (ms < 1000) {
    const s = Math.max(0.1, Math.round(ms / 100) / 10);
    return `${s.toFixed(1)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function resolveToolIcon(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes('read') || lower.includes('cat') || lower.includes('view')) {
    return 'document-text-outline';
  }
  if (lower.includes('write') || lower.includes('edit') || lower.includes('patch')) {
    return 'create-outline';
  }
  if (lower.includes('grep') || lower.includes('search') || lower.includes('find') || lower.includes('glob')) {
    return 'search-outline';
  }
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec') || lower.includes('terminal')) {
    return 'terminal-outline';
  }
  if (lower.includes('git')) {
    return 'git-branch-outline';
  }
  return 'construct-outline';
}

function resolveToolVerb(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes('read')) return 'Read';
  if (lower.includes('write')) return 'Wrote';
  if (lower.includes('edit')) return 'Edited';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) return 'Searched';
  if (lower.includes('bash') || lower.includes('terminal')) return 'Ran';
  return toolName.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function normalizeActivityStep(msg: ChatMessage): NormalizedActivityStep {
  const isMsgRunning = Boolean(msg.isStreaming || msg.meta?.running);

  if (msg.kind === 'thinking') {
    const words = msg.content ? msg.content.trim().split(/\s+/).filter(Boolean).length : 0;
    return {
      id: msg.id,
      kind: 'thinking',
      iconName: 'sparkles-outline',
      verb: isMsgRunning ? 'Thinking' : 'Thought process',
      target: words > 0 ? `${words} word${words !== 1 ? 's' : ''}` : undefined,
      status: isMsgRunning ? 'running' : 'completed',
      rawContent: msg.content,
      detailType: 'thinking',
    };
  }

  if (msg.kind === 'commandExecution') {
    const rawCmd = (msg.meta?.command as string) ?? msg.content ?? '';
    const exitCode = typeof msg.meta?.exitCode === 'number' ? msg.meta.exitCode : undefined;
    const isFailed = exitCode !== undefined && exitCode !== 0;
    const human = humanizeCommand(rawCmd, isMsgRunning);
    const durationMs = typeof msg.meta?.durationMs === 'number' ? msg.meta.durationMs : undefined;

    return {
      id: msg.id,
      kind: 'commandExecution',
      iconName: 'terminal-outline',
      verb: human.verb,
      target: human.target,
      status: isMsgRunning ? 'running' : isFailed ? 'failed' : 'completed',
      duration: durationMs ? formatActivityDuration(durationMs) : undefined,
      rawContent: msg.content,
      detailType: 'command',
      command: rawCmd,
      output: (msg.meta?.output as string) ?? '',
      exitCode,
    };
  }

  if (msg.kind === 'toolActivity') {
    const toolName = (msg.meta?.tool as string) ?? msg.content.replace(/^🔧\s*/, '').split(' ')[0] ?? 'tool';
    const filePath = (msg.meta?.filePath ?? msg.meta?.path ?? '') as string;
    const durationMs = typeof msg.meta?.durationMs === 'number' ? msg.meta.durationMs : undefined;
    const isFailed = msg.meta?.success === false;

    return {
      id: msg.id,
      kind: 'toolActivity',
      iconName: resolveToolIcon(toolName),
      verb: resolveToolVerb(toolName),
      target: filePath || (msg.meta?.title as string) || (msg.content.replace(/^🔧\s*/, '')),
      status: isMsgRunning ? 'running' : isFailed ? 'failed' : 'completed',
      duration: durationMs ? formatActivityDuration(durationMs) : undefined,
      rawContent: msg.content,
      detailType: 'tool',
      filePath: filePath || undefined,
      output: (msg.meta?.output as string) ?? undefined,
    };
  }

  if (msg.kind === 'fileChange') {
    const filePath = (msg.meta?.path as string) ?? msg.content.split(' ').slice(-1)[0] ?? '';
    const changeType = (msg.meta?.changeType as 'create' | 'modify' | 'delete') ?? 'modify';
    const iconName =
      changeType === 'create'
        ? 'add-circle-outline'
        : changeType === 'delete'
          ? 'trash-outline'
          : 'git-commit-outline';

    const verb =
      changeType === 'create' ? 'Created' : changeType === 'delete' ? 'Deleted' : 'Modified';

    return {
      id: msg.id,
      kind: 'fileChange',
      iconName,
      verb,
      target: filePath,
      status: 'completed',
      rawContent: msg.content,
      detailType: 'file',
      filePath,
      diff: (msg.meta?.diff as string) ?? undefined,
      changeType,
    };
  }

  if (msg.kind === 'subagentAction') {
    const subName = (msg.meta?.name as string) ?? 'Subagent';
    const subAction = (msg.meta?.action as string) ?? 'Task';
    const subStatus = (msg.meta?.status as string) ?? '';

    return {
      id: msg.id,
      kind: 'subagentAction',
      iconName: 'git-branch-outline',
      verb: subAction.replace(/^./, (c) => c.toUpperCase()),
      target: subName,
      status: subStatus === 'running' || isMsgRunning ? 'running' : 'completed',
      rawContent: msg.content,
      detailType: 'subagent',
      subagentName: subName,
      subagentAction: subAction,
      output: msg.content,
    };
  }

  return {
    id: msg.id,
    kind: msg.kind,
    iconName: 'cube-outline',
    verb: 'Action',
    target: msg.content,
    status: isMsgRunning ? 'running' : 'completed',
    rawContent: msg.content,
    detailType: 'tool',
  };
}

export function deriveActivitySummary(
  messages: ChatMessage[],
  isStreamActive = false,
): ActivitySummary {
  const steps = messages.map(normalizeActivityStep);
  const totalSteps = steps.length;
  const isActive = isStreamActive || steps.some((s) => s.status === 'running');
  const hasError = steps.some((s) => s.status === 'failed');

  let activeStepIndex = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'running') {
      activeStepIndex = i;
      break;
    }
  }

  // Duration computation
  let durationMs = 0;
  if (messages.length > 1) {
    const firstTs = messages[0].timestamp;
    const lastTs = messages[messages.length - 1].timestamp;
    if (lastTs > firstTs) {
      durationMs = lastTs - firstTs;
    }
  }
  if (durationMs === 0) {
    for (const m of messages) {
      if (typeof m.meta?.durationMs === 'number' && m.meta.durationMs > 0) {
        durationMs += m.meta.durationMs;
      }
    }
  }
  const formattedDuration = formatActivityDuration(durationMs);

  // Category counts
  let toolCount = 0;
  let fileCount = 0;
  let cmdCount = 0;
  let thinkCount = 0;
  let subagentCount = 0;

  for (const s of steps) {
    if (s.detailType === 'tool') toolCount++;
    else if (s.detailType === 'file') fileCount++;
    else if (s.detailType === 'command') cmdCount++;
    else if (s.detailType === 'thinking') thinkCount++;
    else if (s.detailType === 'subagent') subagentCount++;
  }

  const pills: string[] = [];
  const actionCount = toolCount + cmdCount;
  if (actionCount > 0) {
    pills.push(`${actionCount} tool${actionCount > 1 ? 's' : ''}`);
  }
  if (fileCount > 0) {
    pills.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
  }
  if (thinkCount > 0 && actionCount === 0 && fileCount === 0) {
    pills.push('thinking');
  }
  if (subagentCount > 0) {
    pills.push(`${subagentCount} agent${subagentCount > 1 ? 's' : ''}`);
  }

  // Dynamic header title
  let title = '';
  if (isActive) {
    const activeStep = activeStepIndex >= 0 ? steps[activeStepIndex] : steps[steps.length - 1];
    if (activeStep?.detailType === 'thinking') {
      title = 'Thinking…';
    } else if (activeStep?.verb) {
      const targetHint = activeStep.target ? ` ${activeStep.target}` : '';
      title = `${activeStep.verb}${targetHint}…`;
      if (title.length > 36) {
        title = `${activeStep.verb}…`;
      }
    } else {
      title = `Working (${totalSteps} step${totalSteps !== 1 ? 's' : ''})…`;
    }
  } else if (totalSteps === 1) {
    const only = steps[0];
    if (only.detailType === 'thinking') {
      title = 'Thought process';
    } else {
      const verb = only.verb;
      const target = only.target ? ` ${only.target}` : '';
      title = `${verb}${target}`;
      if (title.length > 40) {
        title = `${verb} ${only.detailType === 'command' ? 'command' : 'tool'}`;
      }
    }
  } else {
    if (actionCount > 0 && fileCount === 0) {
      title = `Ran ${actionCount} tool${actionCount !== 1 ? 's' : ''}`;
    } else if (fileCount > 0 && actionCount === 0) {
      title = `Updated ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
    } else {
      title = `Completed ${totalSteps} steps`;
    }
  }

  return {
    title,
    totalSteps,
    isActive,
    hasError,
    durationMs,
    formattedDuration,
    pills,
    hasFileChanges: fileCount > 0,
    fileChangesCount: fileCount,
    activeStepIndex,
  };
}
