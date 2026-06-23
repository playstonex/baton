import type { ResponsesApiRequest, ResponsesContent, ResponsesInputItem } from '../types.js';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicTool,
  AnthropicToolChoice,
  MessagesRequest,
} from './types.js';

/**
 * Convert a Responses API request into an Anthropic Messages API request.
 *
 * Key transformations:
 *   instructions            → system (top-level)
 *   input[] (messages)      → messages[]
 *   input[] (function_call) → assistant content block { type: 'tool_use' }
 *   input[] (function_call_output) → user content block { type: 'tool_result' }
 *   max_output_tokens       → max_tokens
 *   tools (flattened)       → tools[] (input_schema)
 *   tool_choice             → tool_choice
 *   text.format             → dropped (Anthropic has no JSON-schema output mode v1)
 */
export function convertResponsesToAnthropic(req: ResponsesApiRequest): MessagesRequest {
  const { system, messages } = convertInput(req.input, req.instructions);

  const result: MessagesRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_output_tokens ?? 4096,
  };

  if (system) result.system = system;
  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stream) result.stream = true;

  // Only `function` tools have an Anthropic equivalent; Responses-only tool
  // types (web_search, namespace, …) lack a name and would produce malformed
  // tool entries. Filter to function tools only.
  if (req.tools && req.tools.length > 0) {
    const functionTools = req.tools.filter((t) => t.type === 'function' && typeof t.name === 'string');
    if (functionTools.length > 0) {
      result.tools = functionTools.map(convertTool);
    }
  }
  if (req.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(req.tool_choice);
  }

  return result;
}

/** Convert Responses input (+ instructions) into Anthropic system + messages. */
function convertInput(
  input: ResponsesApiRequest['input'],
  instructions?: string,
): { system: string | undefined; messages: AnthropicMessage[] } {
  const messages: AnthropicMessage[] = [];

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return { system: instructions, messages };
  }

  // Anthropic requires alternating user/assistant turns and rejects consecutive
  // same-role messages. We coalesce runs of same-role items into one message.
  for (const item of input as ResponsesInputItem[]) {
    const mapped = convertInputItem(item);
    for (const msg of mapped) {
      const last = messages[messages.length - 1];
      if (last && last.role === msg.role && Array.isArray(last.content) && Array.isArray(msg.content)) {
        // Merge into the previous message of the same role.
        (last.content as AnthropicContentBlock[]).push(...(msg.content as AnthropicContentBlock[]));
      } else {
        messages.push(msg);
      }
    }
  }

  return { system: instructions, messages };
}

/** Map a single Responses input item to Anthropic message(s). */
function convertInputItem(item: ResponsesInputItem): AnthropicMessage[] {
  switch (item.type) {
    case 'message': {
      const text = extractText(item.content);
      if (item.role === 'system') {
        // System messages should have been hoisted to `instructions` by the
        // caller; if one slips through, render as a user text block.
        return [{ role: 'user', content: [{ type: 'text', text }] }];
      }
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      return [{ role, content: [{ type: 'text', text }] }];
    }

    case 'function_call': {
      // An assistant tool invocation.
      return [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: item.call_id,
              name: item.name,
              input: safeParseJson(item.arguments),
            },
          ],
        },
      ];
    }

    case 'function_call_output': {
      // The tool result, delivered as a user-side tool_result block.
      return [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: item.call_id,
              content: item.output,
            },
          ],
        },
      ];
    }

    case 'reasoning': {
      // No Anthropic equivalent — drop.
      return [];
    }
  }
}

/** Pull textual content out of a Responses message content array. */
function extractText(content: ResponsesContent[]): string {
  return content
    .map((part) => {
      if (part.type === 'input_text' || part.type === 'output_text') return part.text ?? '';
      return '';
    })
    .join('');
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Flatten a Responses tool into Anthropic's input_schema shape. */
function convertTool(tool: ResponsesApiRequest['tools'] extends (infer T)[] | undefined ? T : never): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? { type: 'object', properties: {} },
  };
}

/** Map Responses tool_choice to Anthropic tool_choice. */
function convertToolChoice(
  choice: ResponsesApiRequest['tool_choice'],
): AnthropicToolChoice {
  if (typeof choice === 'string') {
    if (choice === 'none') return { type: 'none' };
    if (choice === 'required') return { type: 'any' };
    return { type: 'auto' };
  }
  if (choice && typeof choice === 'object' && 'name' in choice) {
    return { type: 'tool', name: choice.name };
  }
  return { type: 'auto' };
}
