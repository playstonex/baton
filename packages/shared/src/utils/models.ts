export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * Standard registry of known models across agents (Antigravity, Claude Code, Codex, Kiro, OpenCode, Pi).
 * Maps raw model IDs to their official human-readable display names and compact pill labels.
 */
export const KNOWN_MODELS: Record<
  string,
  { name: string; compactName?: string; description?: string }
> = {
  // ── Antigravity (Google) ───────────────────────────────────────────
  'gemini-3.8-flash-high': {
    name: 'Gemini 3.8 Flash (High)',
    compactName: 'Gemini 3.8 Flash',
    description: 'Fast, high-reasoning Gemini model with 1M context',
  },
  'gemini-3.8-flash-medium': {
    name: 'Gemini 3.8 Flash (Medium)',
    compactName: 'Gemini 3.8 Flash',
    description: 'Balanced speed and reasoning Gemini model',
  },
  'gemini-3.8-flash-low': {
    name: 'Gemini 3.8 Flash (Low)',
    compactName: 'Gemini 3.8 Flash',
    description: 'Low-latency Gemini model for quick tasks',
  },
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    compactName: 'Gemini 3.8 Flash',
    description: 'Gemini 3.8 Flash',
  },
  'gemini-3.8-flash-tiered': {
    name: 'Gemini 3.8 Flash (Tiered)',
    compactName: 'Gemini 3.8 Flash',
  },
  'gemini-3.5-flash-lite': {
    name: 'Gemini 3.5 Flash Lite',
    compactName: 'Gemini 3.5 Flash',
  },
  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash Lite',
    compactName: 'Gemini 3.1 Flash',
  },
  'gemini-3.1-flash-image': {
    name: 'Gemini 3.1 Flash Image',
    compactName: 'Gemini 3.1 Image',
  },
  'gemini-3-flash': {
    name: 'Gemini 3 Flash',
    compactName: 'Gemini 3 Flash',
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    compactName: 'Gemini 2.5 Flash',
  },
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash Lite',
    compactName: 'Gemini 2.5 Flash',
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6 (Thinking)',
    compactName: 'Claude Sonnet 4.6',
    description: 'Anthropic Claude Sonnet 4.6 with extended thinking',
  },
  'claude-opus-4-6-thinking': {
    name: 'Claude Opus 4.6 (Thinking)',
    compactName: 'Claude Opus 4.6',
    description: 'Anthropic Claude Opus 4.6 with deep reasoning',
  },
  'gpt-oss-120b-medium': {
    name: 'GPT-OSS 120B (Medium)',
    compactName: 'GPT-OSS 120B',
    description: 'Open-weights 120B model with medium reasoning',
  },

  // ── Claude Code (Anthropic) ─────────────────────────────────────────
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5',
    compactName: 'Claude Sonnet 4.5',
  },
  'claude-opus-4-5': {
    name: 'Claude Opus 4.5',
    compactName: 'Claude Opus 4.5',
  },
  'claude-haiku-4-5': {
    name: 'Claude Haiku 4.5',
    compactName: 'Claude Haiku 4.5',
  },
  'claude-opus-5.5': {
    name: 'Claude Opus 5.5',
    compactName: 'Claude Opus 5.5',
  },
  'claude-sonnet-5.5': {
    name: 'Claude Sonnet 5.5',
    compactName: 'Claude Sonnet 5.5',
  },
  'claude-haiku-5.5': {
    name: 'Claude Haiku 5.5',
    compactName: 'Claude Haiku 5.5',
  },
  'claude-3-7-sonnet': {
    name: 'Claude 3.7 Sonnet',
    compactName: 'Claude 3.7 Sonnet',
  },
  'claude-3-7-sonnet-latest': {
    name: 'Claude 3.7 Sonnet',
    compactName: 'Claude 3.7 Sonnet',
  },
  'claude-3-5-sonnet-latest': {
    name: 'Claude 3.5 Sonnet',
    compactName: 'Claude 3.5 Sonnet',
  },
  'claude-3-5-haiku-latest': {
    name: 'Claude 3.5 Haiku',
    compactName: 'Claude 3.5 Haiku',
  },
  'claude-3-5-opus-latest': {
    name: 'Claude 3.5 Opus',
    compactName: 'Claude 3.5 Opus',
  },

  // ── Codex (OpenAI) ──────────────────────────────────────────────────
  'gpt-5-codex': {
    name: 'GPT-5 Codex',
    compactName: 'GPT-5 Codex',
  },
  'gpt-5': {
    name: 'GPT-5',
    compactName: 'GPT-5',
  },
  'gpt-5.6-sol': {
    name: 'GPT-5.6 Sol',
    compactName: 'GPT-5.6 Sol',
  },
  'gpt-5.6-terra': {
    name: 'GPT-5.6 Terra',
    compactName: 'GPT-5.6 Terra',
  },
  'gpt-5.6-luna': {
    name: 'GPT-5.6 Luna',
    compactName: 'GPT-5.6 Luna',
  },
  o3: {
    name: 'o3',
    compactName: 'o3',
  },
  'o3-mini': {
    name: 'o3-mini',
    compactName: 'o3-mini',
  },
  'o4-mini': {
    name: 'o4-mini',
    compactName: 'o4-mini',
  },
  'codex-mini': {
    name: 'Codex Mini',
    compactName: 'Codex Mini',
  },
  'gpt-4o': {
    name: 'GPT-4o',
    compactName: 'GPT-4o',
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    compactName: 'GPT-4o Mini',
  },

  // ── Kiro / OpenCode / Other agents ──────────────────────────────────
  auto: {
    name: 'Auto (Task Optimized)',
    compactName: 'Auto',
    description: 'Models chosen by task for optimal usage and consistent quality',
  },
  'grok-4.7': {
    name: 'Grok 4.7',
    compactName: 'Grok 4.7',
  },
  'deepseek-3.2': {
    name: 'DeepSeek V3.2',
    compactName: 'DeepSeek V3.2',
  },
  'minimax-m2.5': {
    name: 'MiniMax M2.5',
    compactName: 'MiniMax M2.5',
  },
  'glm-5': {
    name: 'GLM-5',
    compactName: 'GLM-5',
  },
  'qwen3-coder-next': {
    name: 'Qwen3 Coder Next',
    compactName: 'Qwen3 Coder',
  },
};

/**
 * Cleanly format any model ID into an accurate, human-readable display name.
 * Never truncates or chops brand names (Gemini, Claude, GPT, etc.) into orphan fragments like "4-6" or "flash-high".
 *
 * @param modelId Raw model ID (e.g. "gemini-3.8-flash-high", "claude-sonnet-4-6")
 * @param options.modelDetails Optional list of ModelInfo provided by the agent/server
 * @param options.compact If true, returns a concise label suitable for chips/pills
 */
export function formatModelName(
  modelId: string | null | undefined,
  options?: {
    modelDetails?: ModelInfo[];
    compact?: boolean;
  },
): string {
  if (!modelId) return 'Model';

  const trimmed = modelId.trim();
  if (!trimmed) return 'Model';

  // 1. Check server-provided modelDetails
  if (options?.modelDetails && options.modelDetails.length > 0) {
    const match = options.modelDetails.find((d) => d.id === trimmed || d.name === trimmed);
    if (match) {
      if (options.compact) {
        // Strip parenthesized suffixes for compact chip: e.g. "Gemini 3.8 Flash (High)" -> "Gemini 3.8 Flash"
        const clean = match.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
        return clean || match.name;
      }
      return match.name;
    }
  }

  // 2. Check known model registry
  const known = KNOWN_MODELS[trimmed];
  if (known) {
    if (options?.compact && known.compactName) {
      return known.compactName;
    }
    return known.name;
  }

  // 3. Handle provider-prefixed IDs (e.g. "opencode/deepseek-v4.1", "magpie/antigravity/gemini-3.8-flash")
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    const provider = parts[0];
    const subCategory = parts.length > 2 ? parts[1] : undefined;
    const leaf = parts[parts.length - 1];

    const cleanLeaf = leaf
      .replace(/^anthropic\./i, '')
      .replace(/^openai\./i, '')
      .replace(/^google\./i, '')
      .replace(/:0$/i, '');

    const knownMatch =
      KNOWN_MODELS[trimmed] ??
      KNOWN_MODELS[parts.slice(1).join('/')] ??
      KNOWN_MODELS[cleanLeaf] ??
      KNOWN_MODELS[leaf];

    const baseName = knownMatch
      ? options?.compact && knownMatch.compactName
        ? knownMatch.compactName
        : knownMatch.name
      : formatFallbackModelName(cleanLeaf, options?.compact);

    const categoryPrefix =
      subCategory && subCategory !== 'antigravity' ? `${subCategory.toUpperCase()}: ` : '';

    if (options?.compact) {
      return `${categoryPrefix}${baseName}`;
    }
    return `${categoryPrefix}${baseName} (${provider})`;
  }

  // 4. Intelligent generic heuristic for custom / unknown model strings:
  return formatFallbackModelName(trimmed, options?.compact);
}

function formatFallbackModelName(raw: string, compact?: boolean): string {
  const formatted = raw
    .replace(/^claude-/i, 'Claude-')
    .replace(/^gemini-/i, 'Gemini-')
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^deepseek-/i, 'DeepSeek-')
    .replace(/^qwen-/i, 'Qwen-')
    .replace(/^qwen3/i, 'Qwen 3')
    .replace(/^minimax-/i, 'MiniMax-')
    .replace(/-thinking$/i, ' (Thinking)')
    .replace(/-high$/i, ' (High)')
    .replace(/-medium$/i, ' (Medium)')
    .replace(/-low$/i, ' (Low)')
    .replace(/-preview$/i, ' (Preview)')
    .replace(/-free$/i, ' (Free)')
    .split(' ')
    .map((word) => {
      // Capitalize segments separated by hyphens (unless already capitalized or version)
      return word
        .split('-')
        .map((segment) => {
          if (!segment) return '';
          if (/^(Claude|Gemini|GPT|DeepSeek|Qwen|MiniMax)$/i.test(segment)) {
            return segment;
          }
          if (segment.startsWith('(')) return segment;
          return segment.charAt(0).toUpperCase() + segment.slice(1);
        })
        .join(' ');
    })
    .join(' ');

  if (compact) {
    return formatted.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  return formatted;
}
