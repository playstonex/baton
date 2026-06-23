import type { ResponsesStreamEvent } from '../types.js';
import type { AnthropicStreamEvent } from './types.js';

/**
 * Convert an Anthropic Messages API SSE stream into a Responses-API SSE event
 * stream. Used when the upstream speaks Anthropic but the caller (Codex)
 * expects Responses-API streaming events.
 *
 * Anthropic event mapping:
 *   message_start                 → response.created
 *   content_block_start (text)    → response.output_item.added + content_part.added
 *   content_block_delta (text)    → response.output_text.delta
 *   content_block_start (tool_use)→ response.output_item.added (function_call)
 *   content_block_delta (input_json_delta) → response.function_call_arguments.delta
 *   content_block_stop            → (per-block) output_text.done / arguments.done + output_item.done
 *   message_delta / message_stop  → response.completed
 */
export async function* convertAnthropicStreamToResponses(
  sseStream: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<ResponsesStreamEvent, void, unknown> {
  const responseId = `resp_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let created = false;

  // Track open content blocks by index so we can close them out.
  const blocks = new Map<number, { kind: 'text' | 'tool_use'; started: boolean }>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const reader = sseStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLine = block
          .split('\n')
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim();
        if (!dataLine) continue;

        let evt: AnthropicStreamEvent;
        try {
          evt = JSON.parse(dataLine) as AnthropicStreamEvent;
        } catch {
          continue;
        }

        if (!created) {
          created = true;
          if (evt.type === 'message_start' && evt.message?.usage) {
            totalInputTokens = evt.message.usage.input_tokens ?? 0;
          }
          yield { type: 'response.created', response: { id: responseId, object: 'response', created_at: createdAt, status: 'in_progress', model } };
        }

        switch (evt.type) {
          case 'content_block_start': {
            const cb = evt.content_block;
            if (cb.type === 'text') {
              blocks.set(evt.index, { kind: 'text', started: true });
              yield {
                type: 'response.output_item.added',
                output_index: evt.index,
                item: { type: 'message', status: 'in_progress', role: 'assistant', content: [] },
              };
              yield {
                type: 'response.content_part.added',
                output_index: evt.index,
                content_index: 0,
                part: { type: 'output_text', text: '' },
              };
            } else if (cb.type === 'tool_use') {
              blocks.set(evt.index, { kind: 'tool_use', started: true });
              yield {
                type: 'response.output_item.added',
                output_index: evt.index,
                item: { type: 'function_call', status: 'in_progress', call_id: cb.id, name: cb.name, arguments: '' },
              };
            }
            break;
          }

          case 'content_block_delta': {
            const d = evt.delta;
            if (d.type === 'text_delta') {
              yield { type: 'response.output_text.delta', output_index: evt.index, content_index: 0, delta: d.text };
            } else if (d.type === 'input_json_delta') {
              yield { type: 'response.function_call_arguments.delta', output_index: evt.index, delta: d.partial_json };
            }
            break;
          }

          case 'content_block_stop': {
            const meta = blocks.get(evt.index);
            blocks.delete(evt.index);
            if (meta?.kind === 'text') {
              yield { type: 'response.output_text.done', output_index: evt.index, text: '' };
              yield { type: 'response.output_item.done', output_index: evt.index, item: { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '' }] } };
            } else if (meta?.kind === 'tool_use') {
              yield { type: 'response.function_call_arguments.done', output_index: evt.index, arguments: '' };
              yield { type: 'response.output_item.done', output_index: evt.index, item: { type: 'function_call', status: 'completed' } };
            }
            break;
          }

          case 'message_delta': {
            if (evt.usage?.output_tokens) totalOutputTokens = evt.usage.output_tokens;
            break;
          }

          case 'message_stop': {
            break;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      status: 'completed',
      model,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      },
    },
  };
}
