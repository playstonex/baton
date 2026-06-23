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

// ---------------------------------------------------------------------------
// Reverse direction: Chat Completions → Responses API
// Used when the upstream speaks Chat Completions but the caller (Codex) expects
// a Responses-API response.
// ---------------------------------------------------------------------------

/**
 * Convert a Chat Completions response into a Responses API response.
 *
 * Reverse of `convertResponse`:
 *   choices[0].message (text)   → output[] message item with output_text
 *   choices[0].message.tool_calls → output[] function_call items
 *   choices[0].finish_reason    → status
 *   usage (prompt_tokens etc.)  → usage (input_tokens etc.)
 */
export function convertChatToResponse(
  chat: ChatCompletionResponse,
  model: string,
): ResponsesApiResponse {
  const output: ResponsesOutputItem[] = [];
  const choice = chat.choices?.[0];
  let outputText = '';

  if (choice?.message) {
    const msg = choice.message;
    // Text content → a message output item carrying output_text.
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      outputText = msg.content;
      output.push({
        type: 'message',
        id: `msg_${chat.id}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: msg.content, annotations: [] }],
      });
    }
    // Tool calls → function_call output items.
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        output.push({
          type: 'function_call',
          id: `fc_${tc.id}`,
          status: 'completed',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }
  }

  return {
    id: chat.id,
    object: 'response',
    created_at: chat.created,
    status: mapStatusFromFinishReason(choice?.finish_reason ?? null),
    model: model || chat.model,
    output,
    output_text: outputText || undefined,
    usage: chat.usage
      ? {
          input_tokens: chat.usage.prompt_tokens,
          output_tokens: chat.usage.completion_tokens,
          total_tokens: chat.usage.total_tokens,
        }
      : undefined,
  };
}

function mapStatusFromFinishReason(
  reason: ChatChoice['finish_reason'],
): ResponsesApiResponse['status'] {
  switch (reason) {
    case 'stop':
      return 'completed';
    case 'length':
      return 'incomplete';
    case 'content_filter':
      return 'incomplete';
    case 'tool_calls':
      return 'completed';
    default:
      return 'completed';
  }
}
