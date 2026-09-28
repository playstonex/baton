import { describe, it, expect } from 'vitest';
import {
  LOCAL_SERVER_ID,
  isLocalHost,
  getConnection,
  describeConnection,
  validateHostProfile,
  type HostProfile,
  type HostConnection,
} from '../host/index.js';

function tcpConn(overrides: Partial<Extract<HostConnection, { type: 'directTcp' }>> = {}): HostConnection {
  return { id: 'c1', type: 'directTcp', host: '192.168.1.4', port: 3210, ...overrides };
}

function profile(overrides: Partial<HostProfile> = {}): HostProfile {
  return {
    serverId: 'mac-studio',
    label: 'Mac Studio',
    connections: [tcpConn()],
    preferredConnectionId: null,
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
    ...overrides,
  };
}

describe('isLocalHost', () => {
  it('matches the reserved local serverId', () => {
    expect(isLocalHost(profile({ serverId: LOCAL_SERVER_ID }))).toBe(true);
  });

  it('rejects other ids', () => {
    expect(isLocalHost(profile())).toBe(false);
  });
});

describe('getConnection', () => {
  it('returns the preferred connection when present', () => {
    const c2 = tcpConn({ id: 'c2', port: 3211 });
    const p = profile({ connections: [tcpConn(), c2], preferredConnectionId: 'c2' });
    expect(getConnection(p, 'c2')).toBe(c2);
  });

  it('falls back to the first connection for a dangling preference', () => {
    const c1 = tcpConn();
    const p = profile({ connections: [c1], preferredConnectionId: 'gone' });
    expect(getConnection(p, 'gone')).toBe(c1);
  });

  it('returns null when the profile has no connections', () => {
    expect(getConnection(profile({ connections: [] }), null)).toBeNull();
  });
});

describe('describeConnection', () => {
  it('directTcp renders host:port', () => {
    expect(describeConnection(tcpConn())).toBe('192.168.1.4:3210');
  });

  it('remoteSsh marks tunnelling and daemon port', () => {
    const conn: HostConnection = {
      id: 's',
      type: 'remoteSsh',
      host: 'buildbox',
      daemonPort: 3210,
    };
    expect(describeConnection(conn)).toBe('buildbox:3210 (ssh)');
    expect(describeConnection({ ...conn, daemonPort: undefined })).toBe('buildbox (ssh)');
  });

  it('relay prefixes the endpoint', () => {
    const conn: HostConnection = {
      id: 'r',
      type: 'relay',
      relayEndpoint: 'wss://relay.example.com',
    };
    expect(describeConnection(conn)).toBe('relay wss://relay.example.com');
  });
});

describe('validateHostProfile', () => {
  it('accepts a minimal valid profile', () => {
    expect(validateHostProfile(profile())).toEqual([]);
  });

  it('rejects invalid serverId characters', () => {
    const issues = validateHostProfile(profile({ serverId: 'bad id!' }));
    expect(issues.some((i) => i.field === 'serverId')).toBe(true);
  });

  it('rejects empty labels and empty connection lists', () => {
    const issues = validateHostProfile(profile({ label: '  ', connections: [] }));
    expect(issues.some((i) => i.field === 'label')).toBe(true);
    expect(issues.some((i) => i.field === 'connections')).toBe(true);
  });

  it('flags duplicate connection ids', () => {
    const issues = validateHostProfile({
      ...profile(),
      connections: [tcpConn(), tcpConn()],
    });
    expect(issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });

  it('flags a preferredConnectionId pointing outside the list', () => {
    const issues = validateHostProfile(profile({ preferredConnectionId: 'nope' }));
    expect(
      issues.some((i) => i.field === 'preferredConnectionId'),
    ).toBe(true);
  });

  it('validates port ranges on directTcp', () => {
    const issues = validateHostProfile(
      profile({ connections: [tcpConn({ port: 99999 })] }),
    );
    expect(issues.some((i) => i.message.includes('port'))).toBe(true);
  });
});
