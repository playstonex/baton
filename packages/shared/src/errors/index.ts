export class FlowWhipsError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ShellError extends FlowWhipsError {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;

  constructor(stdout: string, stderr: string, exitCode: number) {
    super('Shell command failed', 'SHELL_ERROR');
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class CryptoError extends FlowWhipsError {
  constructor(message: string) {
    super(message, 'CRYPTO_ERROR');
  }
}

export class ProtocolError extends FlowWhipsError {
  constructor(message: string) {
    super(message, 'PROTOCOL_ERROR');
  }
}

export class ConfigError extends FlowWhipsError {
  readonly filePath?: string;

  constructor(message: string, filePath?: string) {
    super(message, 'CONFIG_ERROR');
    this.filePath = filePath;
  }
}

export class McpError extends FlowWhipsError {
  readonly serverName?: string;

  constructor(message: string, serverName?: string) {
    super(message, 'MCP_ERROR');
    this.serverName = serverName;
  }
}

export class TransportError extends FlowWhipsError {
  constructor(message: string) {
    super(message, 'TRANSPORT_ERROR');
  }
}

export class AgentNotFoundError extends FlowWhipsError {
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Agent ${agentId} not found`, 'AGENT_NOT_FOUND');
    this.agentId = agentId;
  }
}

export class InvalidStateTransitionError extends FlowWhipsError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Invalid state transition: ${from} → ${to}`, 'INVALID_STATE_TRANSITION');
    this.from = from;
    this.to = to;
  }
}

/**
 * `true` for transient errors (network, timeout, transport, MCP).
 * `false` for deterministic failures (crypto, config, missing agent, abort).
 */
export function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) return false;

  if (error instanceof CryptoError) return false;
  if (error instanceof AgentNotFoundError) return false;
  if (error instanceof InvalidStateTransitionError) return false;
  if (error instanceof ConfigError) return false;

  if (error instanceof TransportError) return true;
  if (error instanceof McpError) return true;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('epipe') ||
      msg.includes('enetunreach') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    ) {
      return true;
    }
  }

  return false;
}

export function classifyError(
  error: unknown,
):
  | 'shell'
  | 'crypto'
  | 'protocol'
  | 'config'
  | 'mcp'
  | 'transport'
  | 'network'
  | 'abort'
  | 'unknown' {
  if (isAbortError(error)) return 'abort';

  if (error instanceof ShellError) return 'shell';
  if (error instanceof CryptoError) return 'crypto';
  if (error instanceof ProtocolError) return 'protocol';
  if (error instanceof ConfigError) return 'config';
  if (error instanceof McpError) return 'mcp';
  if (error instanceof TransportError) return 'transport';

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('epipe') ||
      msg.includes('enetunreach') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('timeout')
    ) {
      return 'network';
    }
  }

  return 'unknown';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || error.name === 'AbortError') return true;
  }
  return false;
}
