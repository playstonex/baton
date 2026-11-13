import { describe, it, expect } from 'vitest';
import { parseSessionUrl } from '../hooks/parseSessionUrl';

describe('Deep Linking Parser', () => {
  it('parses session url with baton://session/<id>', () => {
    const res = parseSessionUrl('baton://session/sess_123');
    expect(res).toEqual({ sessionId: 'sess_123', action: undefined });
  });

  it('parses agent url with baton://agent/<id>', () => {
    const res = parseSessionUrl('baton://agent/agent_456');
    expect(res).toEqual({ sessionId: 'agent_456', action: undefined });
  });

  it('parses action=approve from Live Activity', () => {
    const res = parseSessionUrl('baton://agent/sess_789?action=approve');
    expect(res).toEqual({ sessionId: 'sess_789', action: 'approve' });
  });

  it('parses action=reject from Live Activity', () => {
    const res = parseSessionUrl('baton://agent/sess_789?action=reject');
    expect(res).toEqual({ sessionId: 'sess_789', action: 'reject' });
  });

  it('ignores unrelated protocols or malformed urls', () => {
    expect(parseSessionUrl('https://example.com')).toBeNull();
    expect(parseSessionUrl('baton://invalid')).toBeNull();
    expect(parseSessionUrl('not-a-url')).toBeNull();
  });
});
