export interface ParsedSessionUrl {
  sessionId: string;
  action?: 'approve' | 'reject';
}

/**
 * Parse `baton://session/<id>` or `baton://agent/<id>` (with optional ?action=approve/reject).
 * Supports standard URI forms (baton://session/123 and baton:///session/123).
 * Returns null for unrecognized URLs so unrelated links are ignored.
 */
export function parseSessionUrl(url: string): ParsedSessionUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'baton:') return null;

    let prefix = parsed.hostname;
    let remainder = parsed.pathname.replace(/^\/+/, '');

    // In case of baton:///session/123 (empty hostname)
    if (!prefix) {
      const parts = remainder.split('/');
      prefix = parts[0] ?? '';
      remainder = parts.slice(1).join('/');
    }

    if (prefix !== 'session' && prefix !== 'agent') return null;
    const sessionId = remainder.split('/')[0];
    if (!sessionId) return null;

    const actionParam = parsed.searchParams.get('action');
    const action = actionParam === 'approve' || actionParam === 'reject' ? actionParam : undefined;
    return { sessionId, action };
  } catch {
    return null;
  }
}
