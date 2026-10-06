/**
 * Speech-to-text relay for chat dictation. One recorded clip in, transcript
 * out. The Deepgram API key is read, format-validated and used entirely on
 * the host — it never crosses a client boundary.
 */

const DEEPGRAM_LISTEN_URL = new URL('https://api.deepgram.com/v1/listen');
DEEPGRAM_LISTEN_URL.searchParams.set('model', 'nova-3');
DEEPGRAM_LISTEN_URL.searchParams.set('smart_format', 'true');

const MAX_CLIP_BYTES = 20 * 1024 * 1024;

export interface SttClip {
  audio: ArrayBuffer;
  contentType: string | undefined;
}

export type SttOutcome =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string };

const DEEPGRAM_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Resolve the configured key through a strict allowlist format gate. */
function deepgramKey(): string | null {
  const raw = (process.env.DEEPGRAM_API_KEY ?? '').trim();
  return DEEPGRAM_KEY_PATTERN.test(raw) ? raw : null;
}

/** Validate the caller-supplied media type; parameters are dropped. */
export function sanitizeAudioMime(header: string | undefined): string | null {
  const mediaType = (header ?? 'audio/mp4').split(';')[0].trim();
  return /^audio\/[a-z0-9.+-]+$/i.test(mediaType) ? mediaType : null;
}

/** Proxy one audio clip through Deepgram's prerecorded endpoint. */
export async function transcribeClip(clip: SttClip): Promise<SttOutcome> {
  const key = deepgramKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: 'Speech-to-text is not configured — set DEEPGRAM_API_KEY on the daemon host',
    };
  }
  const mediaType = sanitizeAudioMime(clip.contentType);
  if (!mediaType) {
    return { ok: false, status: 400, error: 'Content-Type must be audio/*' };
  }
  if (clip.audio.byteLength === 0) {
    return { ok: false, status: 400, error: 'Empty audio body' };
  }
  if (clip.audio.byteLength > MAX_CLIP_BYTES) {
    return { ok: false, status: 413, error: 'Audio clip too large' };
  }
  try {
    // Fixed public https host — no caller-controlled URL component exists.
    const upstream = await fetch(DEEPGRAM_LISTEN_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': mediaType },
      body: clip.audio,
    });
    if (!upstream.ok) {
      return {
        ok: false,
        status: 502,
        error: `Transcription service error (${upstream.status})`,
      };
    }
    const data = (await upstream.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    return { ok: true, text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '' };
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'STT failed' };
  }
}
