export async function resumeSessionRequest(sessionId: string): Promise<string> {
  const res = await fetch(`/api/agents/${sessionId}/resume`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Resume failed' }));
    throw new Error(err.error ?? 'Resume failed');
  }
  const data = await res.json();
  return data.sessionId as string;
}
