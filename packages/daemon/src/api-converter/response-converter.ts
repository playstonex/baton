import type {
  ChatChoice,
  ChatCompletionResponse,
  ChatToolCall,
  ChatUsage,
  ResponsesApiResponse,
  ResponsesOutputItem,
} from './types.js';

/**
 * Convert a Responses API response ("response" mode) back into a Chat
 * Completions response ("complete" mode) so existing clients are unaffected.
 *
 * Key transformations:
 *   response.output[]     → choices[0].message (text + tool_calls)
 *   response.output_text  → choices[0].message.content (fast path)
 *   response.usage        → usage (input_tokens → prompt_tokens, etc.)
 *   response.status       → choices[0].finish_reason
 */
export function convertResponse(resp: ResponsesApiResponse): ChatCompletionResponse {
  const toolCalls: ChatToolCall[] = [];
  let textContent = '';
  let refusal: string | null = null;

  // Fast path: use output_text helper if present
  if (resp.output_text) {
    textContent = resp.output_text;
  }

  // Walk the output items to extract text, refusal, and function calls
  for (const item of resp.output) {
    const extracted = extractFromOutputItem(item);
    if (extracted.text && !textContent) textContent = extracted.text;
    if (extracted.refusal) refusal = extracted.refusal;
    if (extracted.toolCall) toolCalls.push(extracted.toolCall);
  }

  const finishReason = mapFinishReason(resp.status, toolCalls.length > 0);

  const message: ChatChoice['message'] = {
    role: 'assistant',
    content: textContent || null,
  };

  if (refusal) {
    message.refusal = refusal;
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const choice: ChatChoice = {
    index: 0,
    message,
    finish_reason: finishReason,
    logprobs: null,
  };

  return {
    id: resp.id,
    object: 'chat.completion',
    created: resp.created_at,
    model: resp.model,
    choices: [choice],
    usage: resp.usage ? mapUsage(resp.usage) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ExtractedItem {
  text: string;
  refusal: string | null;
  toolCall: ChatToolCall | null;
}

function extractFromOutputItem(item: ResponsesOutputItem): ExtractedItem {
  const result: ExtractedItem = { text: '', refusal: null, toolCall: null };

  if (item.type === 'message') {
    for (const block of item.content) {
      if (block.type === 'output_text') {
        result.text += block.text;
      } else if (block.type === 'refusal') {
        result.refusal = block.refusal;
      }
    }
  } else if (item.type === 'function_call') {
    result.toolCall = {
      id: item.call_id,
      type: 'function',
      function: {
        name: item.name,
        arguments: item.arguments,
      },
    };
  }
  // 'reasoning' items are internal to the Responses API — skip in Chat Completions output

  return result;
}

function mapFinishReason(
  status: ResponsesApiResponse['status'],
  hasToolCalls: boolean,
): ChatChoice['finish_reason'] {
  if (status === 'completed') {
    return hasToolCalls ? 'tool_calls' : 'stop';
  }
  if (status === 'incomplete') return 'length';
  if (status === 'failed' || status === 'cancelled') return 'content_filter';
  return 'stop';
}

function mapUsage(usage: NonNullable<ResponsesApiResponse['usage']>): ChatUsage {
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
}
