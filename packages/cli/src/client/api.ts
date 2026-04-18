export const DAEMON_URL = process.env.FLOWWHIPS_URL ?? 'http://localhost:3210';
export const WS_URL = DAEMON_URL.replace(/^http/, 'ws').replace(
  /:(\d+)$/,
  (_, p: string) => `:${Number(p) + 1}`,
);

export async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data;
}
