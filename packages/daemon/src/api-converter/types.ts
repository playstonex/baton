// ============================================================
// Chat Completions API types ("complete" mode)
// POST /v1/chat/completions
// ============================================================

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'json_object' | 'text' } | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
  seed?: number;
  stop?: string | string[];
  n?: number;
  user?: string;
  store?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
  system_fingerprint?: string;
}

export interface ChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ChatToolCall[];
    refusal?: string | null;
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  logprobs?: null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ============================================================
// Streaming types (Chat Completions)
// ============================================================

export interface ChatCompletionStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatStreamChoice[];
  /** Present on the final chunk when stream_options.include_usage is set. */
  usage?: ChatUsage;
}

export interface ChatStreamChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
    tool_calls?: Array<{ index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ============================================================
// Responses API types ("response" mode)
// POST /v1/responses
// ============================================================

export interface ResponsesApiRequest {
  model: string;
  input: ResponsesInput;
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ResponsesTool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; name: string };
  text?: {
    format?:
      | { type: 'json_object' }
      | { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean }
      | { type: 'text' };
  };
  store?: boolean;
  previous_response_id?: string;
  user?: string;
  metadata?: Record<string, string>;
}

export type ResponsesInput = string | ResponsesInputItem[];

export type ResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant' | 'system' | 'developer'; content: ResponsesContent[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; content: ResponsesReasoningContent[]; encrypted_content?: string };

export type ResponsesContent =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' };

export interface ResponsesReasoningContent {
  type: 'reasoning_text';
  text: string;
}

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

// ============================================================
// Responses API output
// ============================================================

export interface ResponsesApiResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'failed' | 'incomplete' | 'in_progress' | 'cancelled';
  model: string;
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens: number };
    output_tokens_details?: { reasoning_tokens: number };
  };
  output_text?: string;
  instructions?: string;
  error?: { code: string; message: string } | null;
}

export type ResponsesOutputItem =
  | {
      type: 'message';
      id: string;
      role: 'assistant';
      status: 'completed';
      content: Array<
        | { type: 'output_text'; text: string; annotations: unknown[] }
        | { type: 'refusal'; refusal: string }
      >;
    }
  | {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status: 'completed';
    }
  | {
      type: 'reasoning';
      id: string;
      summary: string[];
      content?: Array<{ type: string; text: string }>;
    };

// ============================================================
// Responses API streaming events (SSE)
// ============================================================

export interface ResponsesStreamEvent {
  type: string;
  [key: string]: unknown;
}
