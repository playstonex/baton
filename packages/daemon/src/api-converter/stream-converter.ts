import type {
  ChatCompletionStreamChunk,
  ResponsesStreamEvent,
} from './types.js';

/**
 * Translate a Responses API SSE stream into a Chat Completions SSE stream.
 *
 * Responses API emits semantic events like:
 *   response.created
 *   response.output_text.delta
 *   response.function_call_arguments.delta
 *   response.completed
 *
 * Chat Completions expects chunks shaped as:
 *   { choices: [{ delta: { content }, finish_reason }] }
 *
 * This async generator yields SSE-formatted strings ready to be written
 * to the HTTP response.
 */
export async function* convertStream(
  sseStream: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<string, void, unknown> {
  const reader = sseStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseId = '';
  let createdAt = Math.floor(Date.now() / 1000);
  let toolCallIndex = 0;
  let currentToolCallId = '';

  // Send the initial chunk with role: 'assistant'
  yield* yieldChunk({
    id: responseId || 'chatcmpl-init',
    object: 'chat.completion.chunk',
    created: createdAt,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by \n\n)
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const rawEvent of events) {
        const parsed = parseSSEEvent(rawEvent);
        if (!parsed) continue;

        // Track response ID from created event
        if (parsed.type === 'response.created' && parsed.response) {
          responseId = (parsed.response as { id?: string }).id ?? responseId;
          createdAt =
            (parsed.response as { created_at?: number }).created_at ?? createdAt;
        }

        // Text content delta
        if (parsed.type === 'response.output_text.delta') {
          const delta = (parsed as { delta?: string }).delta;
          if (delta) {
            yield* yieldChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: createdAt,
              model,
              choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
            });
          }
        }

        // Function call arguments delta
        if (parsed.type === 'response.function_call_arguments.delta') {
          const delta = (parsed as { delta?: string }).delta;
          const itemId = (parsed as { item_id?: string }).item_id;
          if (itemId && itemId !== currentToolCallId) {
            currentToolCallId = itemId;
            // Emit tool call start with the call id
            yield* yieldChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: createdAt,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: itemId,
                        type: 'function',
                        function: { name: '' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
            toolCallIndex++;
          }
          if (delta) {
            yield* yieldChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: createdAt,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex - 1,
                        function: { arguments: delta },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
          }
        }

        // Function call name from output_item.added
        if (parsed.type === 'response.output_item.added') {
          const item = (parsed as { item?: { type?: string; name?: string; call_id?: string } }).item;
          if (item?.type === 'function_call' && item.call_id) {
            currentToolCallId = item.call_id;
            yield* yieldChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: createdAt,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: item.call_id,
                        type: 'function',
                        function: { name: item.name ?? '' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
            toolCallIndex++;
          }
        }

        // Final event
        if (parsed.type === 'response.completed' || parsed.type === 'response.failed') {
          const finishReason =
            parsed.type === 'response.completed'
              ? toolCallIndex > 0
                ? 'tool_calls'
                : 'stop'
              : 'content_filter';

          // Extract usage from the final response if available
          const resp = (parsed as { response?: { usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } }).response;

          yield* yieldChunk({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          });

          // If we have usage, emit it as a final chunk
          if (resp?.usage) {
            yield* yieldChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: createdAt,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: null }],
            });
          }

          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Send [DONE] sentinel (Chat Completions convention)
  yield 'data: [DONE]\n\n';
}

// ---------------------------------------------------------------------------
// SSE parsing helpers
// ---------------------------------------------------------------------------

function parseSSEEvent(raw: string): ResponsesStreamEvent | null {
  const lines = raw.split('\n');
  let dataStr = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      dataStr += trimmed.slice(5).trim();
    } else if (trimmed.startsWith('event:')) {
      // Event type line — we embed it in the data JSON's "type" via OpenAI's convention
      // OpenAI Responses API includes "type" in the JSON data itself, so we skip this
    }
  }

  if (!dataStr || dataStr === '[DONE]') return null;

  try {
    return JSON.parse(dataStr) as ResponsesStreamEvent;
  } catch {
    return null;
  }
}

/** Serialize a chunk to SSE format and yield it. */
async function* yieldChunk(chunk: ChatCompletionStreamChunk): AsyncGenerator<string> {
  yield `data: ${JSON.stringify(chunk)}\n\n`;
}
