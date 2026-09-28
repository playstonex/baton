import type { ApiProviderProfile, UpstreamFormat } from '@baton/shared';
import type { ResponsesApiRequest, ResponsesApiResponse } from './types.js';
import type { ResponsesStreamEvent } from './types.js';

/**
 * Protocol-adapting proxy.
 *
 * Codex always sends Responses-API requests to the daemon's /proxy/responses
 * endpoint. The daemon looks up the target provider, adapts the request to the
 * provider's `upstreamFormat`, forwards it, and adapts the reply back into
 * Responses format. Streaming (SSE) and non-streaming are both handled.
 *
 * Supported upstream formats:
 * - `responses`     — passthrough (upstream speaks Responses API natively)
 * - `openai-chat`   — Responses ↔ Chat Completions
 * - `anthropic`     — Responses ↔ Anthropic Messages
 */

export interface ProxyProvider {
  baseUrl: string;
  /** Real API key resolved from process.env[profile.envKey] by the caller. */
  apiKey: string;
  upstreamFormat: UpstreamFormat;
}

export type ProxyResult =
  | { json: ResponsesApiResponse; status: number }
  | { stream: ReadableStream<Uint8Array>; status: number }
  | { status: number; error: string };

function upstreamUrl(baseUrl: string, format: UpstreamFormat): string {
  const base = baseUrl.replace(/\/$/, '');
  switch (format) {
    case 'responses':
      return `${base}/responses`;
    case 'openai-chat':
      return `${base}/chat/completions`;
    case 'anthropic':
      return `${base}/v1/messages`;
  }
}

function upstreamHeaders(format: UpstreamFormat, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (format === 'anthropic') {
    // Anthropic uses x-api-key + a required version header instead of Bearer.
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function proxyResponses(
  req: ResponsesApiRequest,
  provider: ProxyProvider,
): Promise<ProxyResult> {
  // Lazy-load format-specific converters so the passthrough path has no
  // dependency on the heavier conversion modules.
  const format = provider.upstreamFormat;

  // Build the upstream request body + parser for the response.
  let body: unknown = req;
  let parseUpstreamResponse: (data: unknown) => ResponsesApiResponse;
  let parseUpstreamStream: (stream: ReadableStream<Uint8Array>) => AsyncGenerator<ResponsesStreamEvent>;

  if (format === 'responses') {
    parseUpstreamResponse = (d) => d as ResponsesApiResponse;
    parseUpstreamStream = passthroughStream;
  } else if (format === 'openai-chat') {
    const { convertResponsesToChatRequest } = await import('./responses-to-chat.js');
    const { convertChatToResponse } = await import('./response-converter.js');
    body = convertResponsesToChatRequest(req);
    parseUpstreamResponse = (d) => convertChatToResponse(d as never, req.model);
    parseUpstreamStream = async function* (s) {
      // Chat → Responses stream conversion lives in chat-stream-converter.
      const { convertChatStreamToResponses } = await import('./chat-stream-converter.js');
      yield* convertChatStreamToResponses(s, req.model);
    };
  } else {
    const { convertResponsesToAnthropic } = await import('./anthropic/request-converter.js');
    const { convertAnthropicToResponses } = await import('./anthropic/response-converter.js');
    body = convertResponsesToAnthropic(req);
    parseUpstreamResponse = (d) => convertAnthropicToResponses(d as never, req.model);
    parseUpstreamStream = async function* (s) {
      const { convertAnthropicStreamToResponses } = await import('./anthropic/stream-converter.js');
      yield* convertAnthropicStreamToResponses(s, req.model);
    };
  }

  const resp = await fetch(upstreamUrl(provider.baseUrl, format), {
    method: 'POST',
    headers: upstreamHeaders(format, provider.apiKey),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => 'Unknown upstream error');
    return { status: resp.status, error: errBody };
  }

  if (req.stream && resp.body) {
    const upstream = resp.body;
    const adapted = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const evt of parseUpstreamStream(upstream)) {
            controller.enqueue(encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });
    return { stream: adapted, status: 200 };
  }

  const data = await resp.json();
  return { json: parseUpstreamResponse(data), status: 200 };
}

/** Passthrough: the upstream already emits Responses-API stream events. */
async function* passthroughStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ResponsesStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Responses-API SSE: `event: <type>\ndata: <json>\n\n`
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = block
          .split('\n')
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim();
        if (dataLine) {
          try {
            yield JSON.parse(dataLine) as ResponsesStreamEvent;
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Resolve the real API key for a profile from the environment. The daemon
 * never stores plaintext keys; it reads them from the env var named by
 * `profile.envKey` at request time.
 */
export function resolveApiKey(profile: ApiProviderProfile): string | null {
  return process.env[profile.envKey] ?? null;
}
