import type { ChatCompletionStreamChunk, ResponsesStreamEvent } from './types.js';

/**
 * Convert an OpenAI Chat Completions SSE stream into a Responses-API SSE
 * event stream. This is used when the upstream speaks Chat Completions but the
 * caller (Codex) expects Responses-API streaming events.
 *
 * Emits the canonical Responses event sequence:
 *   response.created
 *   response.output_item.added        (one assistant message item)
 *   response.output_text.delta ...    (text deltas, and tool-call arg deltas)
 *   response.output_text.done / response.function_call_arguments.done
 *   response.output_item.done
 *   response.completed
 */
export async function* convertChatStreamToResponses(
  sseStream: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<ResponsesStreamEvent, void, unknown> {
  const responseId = `resp_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);

  let created = false;
  let itemAdded = false;
  let textStarted = false;
  // Track tool calls by index to emit per-call delta events.
  const toolCalls = new Map<number, { id: string; name: string; started: boolean }>();
  // Accumulate each tool call's argument string so the .done event carries the
  // full arguments. codex reads the final arguments from the done event — an
  // empty `arguments` there silently drops the tool call.
  const toolArgBuffers = new Map<number, string>();
  let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

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
        if (dataLine === '[DONE]') continue;

        let chunk: ChatCompletionStreamChunk;
        try {
          chunk = JSON.parse(dataLine) as ChatCompletionStreamChunk;
        } catch {
          continue;
        }

        if (!created) {
          created = true;
          yield { type: 'response.created', response: { id: responseId, object: 'response', created_at: createdAt, status: 'in_progress', model } };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          // Some chunks carry only usage (e.g. final chunk with stream_options.include_usage).
          if (chunk.usage) usage = chunk.usage;
          continue;
        }

        // Text content delta
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (!itemAdded) {
            itemAdded = true;
            yield {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', status: 'in_progress', role: 'assistant', content: [] },
            };
          }
          if (!textStarted) {
            textStarted = true;
            yield { type: 'response.content_part.added', item_id: undefined, output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } };
          }
          yield { type: 'response.output_text.delta', item_id: undefined, output_index: 0, content_index: 0, delta: delta.content };
          continue;
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            let entry = toolCalls.get(idx);
            if (!entry) {
              entry = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? '', started: false };
              toolCalls.set(idx, entry);
            }
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;

            if (!entry.started) {
              entry.started = true;
              yield {
                type: 'response.output_item.added',
                output_index: idx,
                item: { type: 'function_call', status: 'in_progress', call_id: entry.id, name: entry.name, arguments: '' },
              };
            }
            if (tc.function?.arguments) {
              toolArgBuffers.set(idx, (toolArgBuffers.get(idx) ?? '') + tc.function.arguments);
              yield {
                type: 'response.function_call_arguments.delta',
                output_index: idx,
                item_id: undefined,
                delta: tc.function.arguments,
              };
            }
          }
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Close out any open text item.
  if (textStarted) {
    yield { type: 'response.output_text.done', output_index: 0, text: '' };
    yield { type: 'response.output_item.done', output_index: 0, item: { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '' }] } };
  }
  // Close out tool-call items. The done event must carry the full accumulated
  // arguments string, and the output_item.done item must include call_id/name.
  for (const [idx, entry] of toolCalls) {
    const args = toolArgBuffers.get(idx) ?? '';
    yield { type: 'response.function_call_arguments.done', output_index: idx, arguments: args };
    yield {
      type: 'response.output_item.done',
      output_index: idx,
      item: { type: 'function_call', status: 'completed', call_id: entry.id, name: entry.name, arguments: args },
    };
  }

  yield {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      status: 'completed',
      model,
      usage: usage
        ? { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.total_tokens }
        : undefined,
    },
  };
}
