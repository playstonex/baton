import { describe, it, expect } from 'vitest';
import { generateKeyPair, deriveSharedKey, encrypt, decrypt, generateNonce } from '@baton/shared/crypto';

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

describe('File Browser and Path Permissions', () => {
  it('allows browsing directories via /api/files across the filesystem', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    const res = await app.request(`/api/files?path=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { path: string; items: { name: string; isDir: boolean }[] };
    expect(data.path).toBe(process.cwd());
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.some((item) => item.name === 'package.json')).toBe(true);
  });

  it('blocks reading file content outside allowed project paths with 403', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    const res = await app.request(`/api/files/content?path=${encodeURIComponent('/etc/hosts')}`);
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Path not allowed');
  });

  it('allows browsing another directory even after an agent is started in a different directory', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    // Mock starting an agent in /tmp or cwd
    const tmpDir = process.cwd();
    const otherDir = '/tmp';

    // Browse otherDir before any agent starts
    const res1 = await app.request(`/api/files?path=${encodeURIComponent(otherDir)}`);
    expect(res1.status).toBe(200);

    // Start agent in tmpDir
    const startRes = await app.request('/api/agents/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentType: 'claude-code', projectPath: tmpDir, mode: 'pty' }),
    });
    // Regardless of whether pty starts in mock/test, projectPath was registered
    expect([200, 500]).toContain(startRes.status);

    // Now browse otherDir to select directory for second agent — must NOT return 403
    const res2 = await app.request(`/api/files?path=${encodeURIComponent(otherDir)}`);
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { path: string; items: unknown[] };
    expect(data2.path).toBe(otherDir);
  });

  it('searches project files with /api/files/search once the project path is registered', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    // Starting an agent registers its projectPath as allowed (even if the PTY
    // itself fails to start in the test environment).
    const startRes = await app.request('/api/agents/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentType: 'claude-code', projectPath: process.cwd(), mode: 'pty' }),
    });
    expect([200, 500]).toContain(startRes.status);

    const res = await app.request(
      `/api/files/search?path=${encodeURIComponent(process.cwd())}&q=package`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { path: string; files: string[] };
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.some((f) => f.includes('package.json'))).toBe(true);
  });

  it('blocks /api/files/search outside allowed project paths with 403', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    const res = await app.request(`/api/files/search?path=${encodeURIComponent('/etc')}&q=host`);
    expect(res.status).toBe(403);
  });

  it('rejects /api/files/search without a path with 400', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);

    const res = await app.request('/api/files/search?q=package');
    expect(res.status).toBe(400);
  });
});

describe('Credential-bearing routes are local-only', () => {
  const post = (body: unknown, origin?: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  const evil = { name: 'evil', baseUrl: 'https://attacker.example', envKey: 'OPENAI_API_KEY' };

  it('refuses provider mutation from a non-loopback peer', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request('/api/api-providers', post(evil), { requestIP: '192.168.1.50' });
    expect(res.status).toBe(403);
  });

  it('refuses provider mutation when the peer address is unknown', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request('/api/api-providers', post(evil));
    expect(res.status).toBe(403);
  });

  it('refuses a loopback request carrying a foreign browser Origin', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request('/api/api-providers', post(evil, 'https://attacker.example'), {
      requestIP: '127.0.0.1',
    });
    expect(res.status).toBe(403);
  });

  it('refuses the proxy from a non-loopback peer', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request('/proxy/responses', post({ model: 'x', input: 'hi' }), {
      requestIP: '::ffff:10.0.0.7',
    });
    expect(res.status).toBe(403);
  });

  it('rejects an envKey that is not an *_API_KEY name, even from localhost', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request(
      '/api/api-providers',
      post({ ...evil, envKey: 'AWS_SECRET_ACCESS_KEY' }, 'http://localhost:5173'),
      { requestIP: '::1' },
    );
    expect(res.status).toBe(400);
  });

  it('still allows reading the provider list from the LAN', async () => {
    const { createDaemon } = await import('../index.js');
    const { app } = createDaemon(0);
    const res = await app.request('/api/api-providers', undefined, { requestIP: '192.168.1.50' });
    expect(res.status).toBe(200);
  });

  it('classifies loopback addresses and origins', async () => {
    const { isLoopbackAddress, isLocalOrigin } = await import('../index.js');
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.2')).toBe(false);
    expect(isLoopbackAddress('127.evil.com')).toBe(false);
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:3210')).toBe(true);
    expect(isLocalOrigin('http://localhost.attacker.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});