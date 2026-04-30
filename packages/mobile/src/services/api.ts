import { useConnectionStore } from '../stores/connection';

export function getHttpUrl(): string {
  const { mode, relayUrl, localHttpUrl } = useConnectionStore.getState();
  if (mode === 'local') return localHttpUrl;
  // Remote: derive gateway URL from relay URL
  return relayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3220');
}

export function getDaemonUrl(): string {
  const { mode, relayUrl, localHttpUrl } = useConnectionStore.getState();
  if (mode === 'local') return localHttpUrl;
  // Remote: assume daemon is on port 3210 of same host
  return relayUrl.replace(/^wss?/, 'http').replace(/:\d+/, ':3210');
}

const API_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = getDaemonUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${path}`, {
      ...opts,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
