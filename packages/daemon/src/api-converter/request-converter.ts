import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatTool,
  ResponsesApiRequest,
  ResponsesInputItem,
  ResponsesContent,
  ResponsesTool,
} from './types.js';

/**
 * Convert a Chat Completions request ("complete" mode) into a Responses API
 * request ("response" mode).
 *
 * Key transformations:
 *   messages[]           → input[] (items) + instructions (extracted system)
 *   max_tokens           → max_output_tokens
 *   response_format      → text.format
 *   tools[].function     → flattened tool objects
 *   tool_choice          → mapped for Responses shape
 *   seed                 → dropped (not supported)
 */
export function convertRequest(req: ChatCompletionRequest): ResponsesApiRequest {
  const { instructions, inputItems } = convertMessages(req.messages);

  const result: ResponsesApiRequest = {
    model: req.model,
    input: inputItems,
    store: req.store ?? false,
  };

  if (instructions) {
    result.instructions = instructions;
  }

  // Token limits: prefer max_completion_tokens, fall back to max_tokens
  const maxTokens = req.max_completion_tokens ?? req.max_tokens;
  if (maxTokens !== undefined) {
    result.max_output_tokens = maxTokens;
  }

  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stream) result.stream = true;
  if (req.user) result.user = req.user;

  // Tools: flatten { type: 'function', function: { name, ... } } → { type: 'function', name, ... }
  if (req.tools && req.tools.length > 0) {
    result.tools = req.tools.map(convertTool);
  }

  // Tool choice mapping
  if (req.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(req.tool_choice);
  }

  // Structured outputs: response_format → text.format
  if (req.response_format) {
    result.text = { format: convertResponseFormat(req.response_format) };
  }

  return result;
}

/**
 * Split messages into:
 *   - instructions: extracted from the first system message (Responses uses a
 *     top-level `instructions` field instead of a system message in input)
 *   - inputItems: the remaining messages converted to Responses input items
 */
function convertMessages(
  messages: ChatMessage[],
): { instructions: string | undefined; inputItems: ResponsesInputItem[] } {
  let instructions: string | undefined;
  const inputItems: ResponsesInputItem[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system': {
        // Extract first system message as instructions; subsequent ones are appended
        const text = extractTextContent(msg.content);
        if (!instructions) {
          instructions = text;
        } else {
          instructions += '\n\n' + text;
        }
        break;
      }

      case 'user': {
        inputItems.push({
          type: 'message',
          role: 'user',
          content: convertMessageContent(msg.content, 'input_text'),
        });
        break;
      }

      case 'assistant': {
        // Assistant message may carry tool_calls from prior turns
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Emit each function_call item
          for (const tc of msg.tool_calls) {
            inputItems.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
          // If there's also text content, emit it as an assistant message
          const text = extractTextContent(msg.content);
          if (text) {
            inputItems.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text }],
            });
          }
        } else {
          inputItems.push({
            type: 'message',
            role: 'assistant',
            content: convertMessageContent(msg.content, 'output_text'),
          });
        }
        break;
      }

      case 'tool': {
        // Tool result message → function_call_output item
        const output = extractTextContent(msg.content);
        inputItems.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id ?? 'unknown',
          output,
        });
        break;
      }
    }
  }

  return { instructions, inputItems };
}

/** Flatten Chat Completions tool definition to Responses API shape. */
function convertTool(tool: ChatTool): ResponsesTool {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict,
  };
}

/** Map tool_choice from Chat Completions to Responses API. */
function convertToolChoice(
  choice: ChatCompletionRequest['tool_choice'],
): ResponsesApiRequest['tool_choice'] {
  if (typeof choice === 'string') return choice;
  // { type: 'function', function: { name } } → { type: 'function', name }
  if (choice && typeof choice === 'object' && 'function' in choice) {
    return { type: 'function', name: choice.function.name };
  }
  return 'auto';
}

/** Map response_format from Chat Completions to Responses API text.format. */
function convertResponseFormat(
  format: NonNullable<ChatCompletionRequest['response_format']>,
): ResponsesApiRequest['text'] extends { format?: infer F } ? F : never {
  if (format.type === 'json_object') {
    return { type: 'json_object' } as never;
  }
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      name: format.json_schema.name,
      schema: format.json_schema.schema,
      strict: format.json_schema.strict,
    } as never;
  }
  return { type: 'text' } as never;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract plain text from string or multimodal content array. */
function extractTextContent(content: string | ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
}

/** Convert Chat Completions message content to Responses content blocks. */
function convertMessageContent(
  content: string | ChatMessage['content'],
  textType: 'input_text' | 'output_text',
): ResponsesContent[] {
  if (typeof content === 'string') {
    return [{ type: textType, text: content } as ResponsesContent];
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === 'text') {
        return { type: textType, text: part.text ?? '' } as ResponsesContent;
      }
      if (part.type === 'image_url' && part.image_url) {
        return {
          type: 'input_image',
          image_url: part.image_url.url,
          detail: part.image_url.detail,
        } as ResponsesContent;
      }
      return { type: textType, text: '' } as ResponsesContent;
    });
  }
  return [{ type: textType, text: '' } as ResponsesContent];
}
