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

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = getDaemonUrl();
  const res = await fetch(`${url}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function searchProjectFiles(projectPath: string, query = ''): Promise<string[]> {
  try {
    const res = await apiFetch<{ files: string[] }>(
      `/api/files/search?path=${encodeURIComponent(projectPath)}&q=${encodeURIComponent(query)}`,
    );
    return res.files ?? [];
  } catch {
    return [];
  }
}

