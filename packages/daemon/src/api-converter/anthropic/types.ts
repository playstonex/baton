/**
 * Anthropic Messages API types.
 * https://docs.anthropic.com/en/api/messages
 *
 * Used by the proxy when a provider's upstreamFormat is 'anthropic'.
 */

export interface MessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: { user_id?: string };
}

export type AnthropicMessage =
  | { role: 'user'; content: string | AnthropicContentBlock[] }
  | {
      role: 'assistant';
      content: string | AnthropicAssistantContentBlock[];
    };

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };

export type AnthropicAssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }
  | { type: 'none' };

export interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicAssistantContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Streaming (SSE) events
// ---------------------------------------------------------------------------

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: MessagesResponse }
  | { type: 'content_block_start'; index: number; content_block: AnthropicAssistantContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null; stop_sequence: string | null }; usage?: { output_tokens: number } }
  | { type: 'message_stop' };

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'message_delta'; stop_reason: string | null; stop_sequence: string | null };
