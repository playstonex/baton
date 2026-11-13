import { describe, it, expect } from 'vitest';
import { formatModelName, type ModelInfo } from '../utils/models.js';

describe('formatModelName', () => {
  it('formats known Antigravity models correctly', () => {
    expect(formatModelName('gemini-3.8-flash-high')).toBe('Gemini 3.8 Flash (High)');
    expect(formatModelName('gemini-3.8-flash-high', { compact: true })).toBe('Gemini 3.8 Flash');
    expect(formatModelName('gemini-3.8-flash-medium')).toBe('Gemini 3.8 Flash (Medium)');
    expect(formatModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6 (Thinking)');
    expect(formatModelName('claude-sonnet-4-6', { compact: true })).toBe('Claude Sonnet 4.6');
    expect(formatModelName('claude-opus-4-6-thinking')).toBe('Claude Opus 4.6 (Thinking)');
    expect(formatModelName('gpt-oss-120b-medium')).toBe('GPT-OSS 120B (Medium)');
  });

  it('uses modelDetails provided by adapter over fallback', () => {
    const details: ModelInfo[] = [{ id: 'custom-model-id', name: 'Custom Agent Model (Turbo)' }];
    expect(formatModelName('custom-model-id', { modelDetails: details })).toBe(
      'Custom Agent Model (Turbo)',
    );
    expect(formatModelName('custom-model-id', { modelDetails: details, compact: true })).toBe(
      'Custom Agent Model',
    );
  });

  it('formats provider/modelId names cleanly', () => {
    expect(formatModelName('opencode/deepseek-v4.1-flash-free', { compact: true })).toBe(
      'DeepSeek V4.1 Flash',
    );
    expect(formatModelName('opencode/deepseek-v4.1-flash-free')).toBe(
      'DeepSeek V4.1 Flash (Free) (opencode)',
    );
  });

  it('handles null, undefined, or empty gracefully', () => {
    expect(formatModelName(null)).toBe('Model');
    expect(formatModelName(undefined)).toBe('Model');
    expect(formatModelName('')).toBe('Model');
  });
});
