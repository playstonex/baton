import type { ToolDefinition, BuiltTool } from './types.js';

const TOOL_DEFAULTS = {
  isReadOnly: false,
  isConcurrencySafe: false,
} as const;

export function buildTool<Input extends Record<string, unknown>>(
  def: ToolDefinition<Input>,
): BuiltTool<Input> {
  return {
    isReadOnly: TOOL_DEFAULTS.isReadOnly,
    isConcurrencySafe: TOOL_DEFAULTS.isConcurrencySafe,
    ...def,
  };
}
