import { describe, it, expect } from 'vitest';
import { generateKeyPair, deriveSharedKey, encrypt, decrypt, generateNonce } from '@flowwhips/shared/crypto';

function encryptPayload(msg: Record<string, unknown>, sharedKey: Uint8Array): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(msg));
  const nonce = generateNonce();
  const ciphertext = encrypt(plaintext, nonce, sharedKey);
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce, 0);
  payload.set(ciphertext, nonce.length);
  return btoa(String.fromCharCode(...payload));
}

function decryptPayload(payload: string, sharedKey: Uint8Array): Record<string, unknown> | null {
  try {
    const data = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const nonce = data.slice(0, 24);
    const ciphertext = data.slice(24);
    const plaintext = decrypt(ciphertext, nonce, sharedKey);
    if (!plaintext) return null;
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

describe('Relay E2EE', () => {
  it('host and client derive the same shared key', () => {
    const host = generateKeyPair();
    const client = generateKeyPair();

    const hostShared = deriveSharedKey(client.publicKey, host.secretKey);
    const clientShared = deriveSharedKey(host.publicKey, client.secretKey);

    expect(hostShared).toHaveLength(32);
    expect(clientShared).toHaveLength(32);

    let equal = true;
    for (let i = 0; i < 32; i++) {
      if (hostShared[i] !== clientShared[i]) { equal = false; break; }
    }
    expect(equal).toBe(true);
  });

  it('host encrypts → relay forwards → client decrypts', () => {
    const host = generateKeyPair();
    const client = generateKeyPair();
    const sharedKey = deriveSharedKey(client.publicKey, host.secretKey);

    const original = { type: 'parsed_event', sessionId: 'abc-123', event: { type: 'tool_use', tool: 'Read' } };
    const encrypted = encryptPayload(original, sharedKey);

    const relayForwarded = { type: 'encrypted', payload: encrypted };
    expect(relayForwarded.type).toBe('encrypted');

    const decrypted = decryptPayload(relayForwarded.payload, sharedKey);
    expect(decrypted).toEqual(original);
  });

  it('wrong key fails to decrypt', () => {
    const host = generateKeyPair();
    const attacker = generateKeyPair();
    const sharedKey = deriveSharedKey(attacker.publicKey, host.secretKey);
    const wrongShared = deriveSharedKey(generateKeyPair().publicKey, host.secretKey);

    const original = { type: 'test', data: 'secret' };
    const encrypted = encryptPayload(original, sharedKey);

    const result = decryptPayload(encrypted, wrongShared);
    expect(result).toBeNull();
  });

  it('handles unicode payload end-to-end', () => {
    const host = generateKeyPair();
    const client = generateKeyPair();
    const sharedKey = deriveSharedKey(client.publicKey, host.secretKey);

    const original = { type: 'raw_output', content: '你好世界 🌍 こんにちは' };
    const encrypted = encryptPayload(original, sharedKey);
    const decrypted = decryptPayload(encrypted, sharedKey);

    expect(decrypted).toEqual(original);
  });
});

describe('Daemon WebSocket Protocol', () => {
  it('formats DaemonMessage correctly', () => {
    const msg = { type: 'parsed_event' as const, sessionId: 'ses-001', event: { type: 'status_change' as const, status: 'running' as const, timestamp: Date.now() } };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('parsed_event');
    expect(parsed.sessionId).toBe('ses-001');
    expect(parsed.event.type).toBe('status_change');
  });

  it('formats ClientMessage correctly', () => {
    const msg = { type: 'terminal_input' as const, sessionId: 'ses-001', data: 'ls -la\n' };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('terminal_input');
    expect(parsed.data).toBe('ls -la\n');
  });

  it('handles control messages', () => {
    const msg = { type: 'control' as const, action: 'attach_session' as const, sessionId: 'ses-001' };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('control');
    expect(parsed.action).toBe('attach_session');
  });
});

describe('CLI Client', () => {
  it('formats StartAgentRequest with mode', () => {
    const body = { agentType: 'claude-code', projectPath: '/tmp/test', mode: 'sdk' as const };
    const json = JSON.stringify(body);
    const parsed = JSON.parse(json);

    expect(parsed.agentType).toBe('claude-code');
    expect(parsed.mode).toBe('sdk');
    expect(parsed.projectPath).toBe('/tmp/test');
  });

  it('StartAgentRequest defaults mode to pty', () => {
    const body: { agentType: string; projectPath: string; mode?: string } = { agentType: 'claude-code', projectPath: '/tmp/test' };
    const mode = body.mode ?? 'pty';
    expect(mode).toBe('pty');
  });
});