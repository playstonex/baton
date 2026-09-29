// Neutral multi-host data model shared across daemon/app/mobile (plan B).
// A HostProfile describes ONE daemon the user can connect to; a client keeps
// several and namespaces agents/sessions per serverId. Connection shapes are
// transport-agnostic — direct TCP/socket/pipe, SSH-tunnelled, or relay.

/** Discriminator union: how to reach a daemon's transport endpoint. */
export type HostConnection =
  | { id: string; type: 'directTcp'; host: string; port: number }
  /** Unix domain socket path. */
  | { id: string; type: 'directSocket'; path: string }
  /** Windows named pipe path. */
  | { id: string; type: 'directPipe'; path: string }
  | {
      id: string;
      type: 'remoteSsh';
      host: string;
      sshPort?: number;
      /** Daemon port on the remote side of the tunnel. */
      daemonPort?: number;
    }
  | {
      id: string;
      type: 'relay';
      relayEndpoint: string;
      useTls?: boolean;
      /** Base64 daemon public key for the relay's E2E NaCl box. */
      daemonPublicKeyB64?: string;
    };

export type HostConnectionType = HostConnection['type'];

/** One user-managed daemon. The implicit local daemon uses serverId 'local'. */
export interface HostProfile {
  serverId: string;
  label: string;
  /** Ordered failover chain — clients try preferredConnectionId first. */
  connections: HostConnection[];
  preferredConnectionId: string | null;
  /** Reference (not the secret) to per-host credentials in secure storage. */
  credentialRef?: string;
  createdAt: string;
  updatedAt: string;
}

export const LOCAL_SERVER_ID = 'local';

/** True when the profile describes the implicit local daemon. */
export function isLocalHost(profile: HostProfile): boolean {
  return profile.serverId === LOCAL_SERVER_ID;
}

export function getConnection(
  profile: HostProfile,
  connectionId: string | null | undefined,
): HostConnection | null {
  if (connectionId) {
    const hit = profile.connections.find((c) => c.id === connectionId);
    if (hit) return hit;
  }
  return profile.connections[0] ?? null;
}

/** Human-facing endpoint summary, e.g. `192.168.1.4:3210` or `relay:443`. */
export function describeConnection(conn: HostConnection): string {
  switch (conn.type) {
    case 'directTcp':
      return `${conn.host}:${conn.port}`;
    case 'directSocket':
      return conn.path;
    case 'directPipe':
      return conn.path;
    case 'remoteSsh':
      return `${conn.host}${conn.daemonPort ? `:${conn.daemonPort}` : ''} (ssh)`;
    case 'relay':
      return `relay ${conn.relayEndpoint}`;
  }
}

// ── Validation (mirrors the zod style of protocol/handshake.ts, hand-rolled
// so shared stays runtime-dependency-free for the daemon bundle) ─────────────

export interface HostValidationIssue {
  field: string;
  message: string;
}

const SERVER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** Structural validation for a profile before it is persisted. */
export function validateHostProfile(profile: HostProfile): HostValidationIssue[] {
  const issues: HostValidationIssue[] = [];
  if (!SERVER_ID_RE.test(profile.serverId)) {
    issues.push({
      field: 'serverId',
      message: 'must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,63}',
    });
  }
  if (!profile.label.trim()) {
    issues.push({ field: 'label', message: 'must not be empty' });
  }
  if (profile.connections.length === 0) {
    issues.push({ field: 'connections', message: 'at least one connection required' });
  }
  const connIds = new Set<string>();
  for (const conn of profile.connections) {
    if (connIds.has(conn.id)) {
      issues.push({ field: 'connections', message: `duplicate connection id '${conn.id}'` });
    }
    connIds.add(conn.id);
    issues.push(...validateHostConnection(conn));
  }
  if (
    profile.preferredConnectionId &&
    !profile.connections.some((c) => c.id === profile.preferredConnectionId)
  ) {
    issues.push({
      field: 'preferredConnectionId',
      message: 'must reference one of connections[].id',
    });
  }
  return issues;
}

export function validateHostConnection(conn: HostConnection): HostValidationIssue[] {
  const issues: HostValidationIssue[] = [];
  const push = (message: string) =>
    issues.push({ field: `connections[${conn.id}]`, message });
  switch (conn.type) {
    case 'directTcp':
      if (!conn.host.trim()) push('host must not be empty');
      if (!Number.isInteger(conn.port) || conn.port < 1 || conn.port > 65535) {
        push('port must be an integer in [1, 65535]');
      }
      break;
    case 'directSocket':
    case 'directPipe':
      if (!conn.path.trim()) push('path must not be empty');
      break;
    case 'remoteSsh':
      if (!conn.host.trim()) push('host must not be empty');
      if (conn.sshPort != null && (conn.sshPort < 1 || conn.sshPort > 65535)) {
        push('sshPort must be in [1, 65535]');
      }
      if (conn.daemonPort != null && (conn.daemonPort < 1 || conn.daemonPort > 65535)) {
        push('daemonPort must be in [1, 65535]');
      }
      break;
    case 'relay':
      if (!conn.relayEndpoint.trim()) push('relayEndpoint must not be empty');
      break;
  }
  return issues;
}
