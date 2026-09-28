import type { ResponsesApiResponse, ResponsesOutputItem } from '../types.js';
import type { MessagesResponse } from './types.js';

/**
 * Convert an Anthropic Messages API response into a Responses API response.
 *
 * Key transformations:
 *   content[] (text blocks)     → output[] message item with output_text
 *   content[] (tool_use blocks) → output[] function_call items
 *   stop_reason                 → status
 *   usage                       → usage (Anthropic has no total_tokens; compute)
 */
export function convertAnthropicToResponses(
  resp: MessagesResponse,
  model: string,
): ResponsesApiResponse {
  const output: ResponsesOutputItem[] = [];
  const textParts: string[] = [];
  const toolCalls: { id: string; name: string; arguments: string }[] = [];

  for (const block of resp.content ?? []) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }

  // Emit a single message item carrying any text content.
  if (textParts.length > 0) {
    output.push({
      type: 'message',
      id: `msg_${resp.id}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: textParts.join(''), annotations: [] }],
    });
  }

  // Emit one function_call item per tool_use block.
  for (const tc of toolCalls) {
    output.push({
      type: 'function_call',
      id: `fc_${tc.id}`,
      status: 'completed',
      call_id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    });
  }

  const usage = resp.usage
    ? {
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
      }
    : undefined;

  return {
    id: resp.id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: mapStatus(resp.stop_reason),
    model: model || resp.model,
    output,
    output_text: textParts.length > 0 ? textParts.join('') : undefined,
    usage,
  };
}

function mapStatus(
  stopReason: MessagesResponse['stop_reason'],
): ResponsesApiResponse['status'] {
  switch (stopReason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'completed';
    case 'max_tokens':
      return 'incomplete';
    default:
      return 'completed';
  }
}
