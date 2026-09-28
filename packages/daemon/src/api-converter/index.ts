import { convertRequest } from './request-converter.js';
import { convertResponse } from './response-converter.js';
import { convertStream } from './stream-converter.js';
import { ApiModeSchema, type ApiMode } from '@baton/shared';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ResponsesApiResponse,
} from './types.js';

export { convertRequest } from './request-converter.js';
export { convertResponse } from './response-converter.js';
export { convertStream } from './stream-converter.js';
export { ApiProviderRegistry } from './registry.js';
export type * from './types.js';
export { ApiModeSchema, type ApiMode };

export interface ConverterConfig {
  apiKey: string;
  baseUrl: string; // e.g. https://api.openai.com/v1
  /**
   * How to address the upstream endpoint.
   * - `responses`: convert Chat Completions ↔ Responses (default).
   * - `chat-completions`: forward the request unchanged (passthrough).
   */
  apiMode?: ApiMode;
}

export interface ProxyResult {
  /** Non-streaming: the converted Chat Completions JSON response. */
  json?: ChatCompletionResponse;
  /** Streaming: a ReadableStream emitting SSE-formatted Chat Completions chunks. */
  stream?: ReadableStream<Uint8Array>;
  /** HTTP status code from the upstream Responses API. */
  status: number;
  /** Error message if the upstream call failed. */
  error?: string;
}

/**
 * Core proxy handler.
 *
 * `config.apiMode` selects the upstream endpoint shape:
 * - `responses` (default): the request is a Chat Completions payload; it is
 *   converted to a Responses API request, forwarded to `${baseUrl}/responses`,
 *   and the reply is converted back to Chat Completions.
 * - `chat-completions`: the request is forwarded unchanged to
 *   `${baseUrl}/chat/completions` and the reply is passed through as-is.
 *
 * Handles both streaming and non-streaming modes transparently.
 */
export async function proxyChatCompletion(
  chatReq: ChatCompletionRequest,
  config: ConverterConfig,
): Promise<ProxyResult> {
  // Note: providers are now consumed directly by the Codex CLI (via the
  // config.toml sync in codex-sync.ts) rather than proxied by the daemon.
  // This converter is retained for completeness / future reuse.

  // Step 1: Convert Chat Completions → Responses API request
  const responsesReq = convertRequest(chatReq);

  // Step 2: Forward to OpenAI Responses API
  const upstreamUrl = `${config.baseUrl.replace(/\/$/, '')}/responses`;
  const upstreamResp = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(responsesReq),
  });

  // Handle upstream errors
  if (!upstreamResp.ok) {
    const errBody = await upstreamResp.text().catch(() => 'Unknown error');
    return { status: upstreamResp.status, error: errBody };
  }

  // Step 3a: Streaming mode — pipe through stream converter
  if (chatReq.stream && upstreamResp.body) {
    const upstreamBody = upstreamResp.body;
    const convertedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of convertStream(upstreamBody, chatReq.model)) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });

    return { stream: convertedStream, status: 200 };
  }

  // Step 3b: Non-streaming — convert the JSON response
  const responsesData = (await upstreamResp.json()) as ResponsesApiResponse;
  const chatResp = convertResponse(responsesData);
  return { json: chatResp, status: 200 };
}
