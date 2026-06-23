import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatTool,
  ResponsesApiRequest,
  ResponsesContent,
  ResponsesInputItem,
  ResponsesTool,
} from './types.js';

/**
 * Convert a Responses API request ("response" mode) into a Chat Completions
 * request ("complete" mode). This is the reverse of `convertRequest` in
 * request-converter.ts and is used when the upstream provider speaks Chat
 * Completions but the caller (Codex) speaks Responses.
 *
 * Key transformations (reverse of convertRequest):
 *   instructions + input[]     → messages[]
 *   max_output_tokens          → max_completion_tokens
 *   text.format                → response_format
 *   tools (flattened)          → tools[].function
 *   tool_choice                → mapped for Chat shape
 *   function_call / output     → assistant tool_calls / tool messages
 */
export function convertResponsesToChatRequest(req: ResponsesApiRequest): ChatCompletionRequest {
  const messages = convertInputToMessages(req.input, req.instructions);

  const result: ChatCompletionRequest = {
    model: req.model,
    messages,
  };

  // Token limits: Responses max_output_tokens → Chat max_completion_tokens
  if (req.max_output_tokens !== undefined) {
    result.max_completion_tokens = req.max_output_tokens;
  }

  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stream) result.stream = true;
  if (req.user) result.user = req.user;

  // Tools: Responses { type: 'function', name, ... } → Chat { type: 'function', function: { name, ... } }
  // Only `function` tools have a Chat Completions equivalent. The Responses API
  // also emits `web_search`, `namespace` (tool groups), and other non-function
  // tool types that have no name/parameters — passing those through produces
  // malformed function entries (`{function:{}}`) that upstreams like GLM reject
  // as "invalid parameters". Filter to function tools only.
  if (req.tools && req.tools.length > 0) {
    const functionTools = req.tools.filter((t) => t.type === 'function' && typeof t.name === 'string');
    if (functionTools.length > 0) {
      result.tools = functionTools.map(convertTool);
    }
  }

  // Tool choice mapping
  if (req.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(req.tool_choice);
  }

  // Structured outputs: text.format → response_format
  if (req.text?.format) {
    result.response_format = convertResponseFormat(req.text.format);
  }

  return result;
}

/**
 * Convert Responses `input` (string or items[]) + top-level `instructions`
 * into a Chat Completions `messages[]` array. A leading instructions becomes a
 * system message; each input item maps to one or more chat messages.
 */
function convertInputToMessages(
  input: ResponsesApiRequest['input'],
  instructions?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (instructions) {
    messages.push({ role: 'system', content: instructions });
  }

  // `input` may be a plain string (single user turn).
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return messages;
  }

  for (const item of input) {
    const mapped = convertInputItem(item);
    // An input item may produce multiple messages (e.g. an assistant turn with
    // both tool_calls and text).
    for (const msg of mapped) messages.push(msg);
  }

  return messages;
}

/** Map a single Responses input item to Chat message(s). */
function convertInputItem(item: ResponsesInputItem): ChatMessage[] {
  switch (item.type) {
    case 'message': {
      const text = extractResponsesText(item.content);
      if (item.role === 'system') {
        return [{ role: 'system', content: text }];
      }
      if (item.role === 'assistant') {
        return [{ role: 'assistant', content: text }];
      }
      // user / developer both map to user for Chat Completions
      return [{ role: 'user', content: text }];
    }

    case 'function_call': {
      // An assistant tool call. Chat expects it nested under an assistant
      // message's `tool_calls`.
      return [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: item.call_id,
              type: 'function',
              function: { name: item.name, arguments: item.arguments },
            },
          ],
        },
      ];
    }

    case 'function_call_output': {
      // The tool result that follows a function_call.
      return [{ role: 'tool', content: item.output, tool_call_id: item.call_id }];
    }

    case 'reasoning': {
      // Reasoning items have no Chat Completions equivalent — drop them.
      return [];
    }
  }
}

/** Pull the textual content out of a Responses message content array. */
function extractResponsesText(content: ResponsesContent[]): string {
  return content
    .map((part) => {
      if (part.type === 'input_text' || part.type === 'output_text') {
        return part.text ?? '';
      }
      return '';
    })
    .join('');
}

/** Nest a flattened Responses tool back into Chat's { function: {...} } shape. */
function convertTool(tool: ResponsesTool): ChatTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    },
  };
}

/** Map tool_choice from Responses API to Chat Completions. */
function convertToolChoice(
  choice: ResponsesApiRequest['tool_choice'],
): ChatCompletionRequest['tool_choice'] {
  if (typeof choice === 'string') return choice;
  // Responses { type: 'function', name } → Chat { type: 'function', function: { name } }
  if (choice && typeof choice === 'object' && 'name' in choice) {
    return { type: 'function', function: { name: choice.name } };
  }
  return 'auto';
}

/** Map text.format from Responses API back to Chat response_format. */
function convertResponseFormat(
  format: NonNullable<NonNullable<ResponsesApiRequest['text']>['format']>,
): ChatCompletionRequest['response_format'] {
  if (format.type === 'json_object') {
    return { type: 'json_object' };
  }
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: format.name, schema: format.schema, strict: format.strict },
    };
  }
  return { type: 'text' };
}
