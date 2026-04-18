// Binary frame format: [1 byte channel] [8 bytes timestamp BE] [N bytes payload]

// Channel definitions
export enum Channel {
  Control = 0, // JSON — hello/welcome/subscribe/unsubscribe
  Terminal = 1, // Raw bytes — xterm.js data stream
  Events = 2, // JSON — ParsedEvent structured events
}

export const CHANNEL_NAMES: Record<Channel, string> = {
  [Channel.Control]: 'control',
  [Channel.Terminal]: 'terminal',
  [Channel.Events]: 'events',
};

// Frame header size: 1 (channel) + 8 (timestamp) = 9 bytes
const HEADER_SIZE = 1 + 8;

// Encode a binary frame
export function encodeFrame(channel: Channel, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + payload.length);
  const view = new DataView(frame.buffer);

  // Channel byte
  frame[0] = channel;

  // Timestamp (8 bytes, big-endian)
  view.setBigUint64(1, BigInt(Date.now()), false);

  // Payload
  frame.set(payload, HEADER_SIZE);

  return frame;
}

// Decode a binary frame
export function decodeFrame(data: Uint8Array): {
  channel: Channel;
  timestamp: number;
  payload: Uint8Array;
} {
  if (data.length < HEADER_SIZE) {
    throw new Error(`Frame too short: ${data.length} bytes (minimum ${HEADER_SIZE})`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const channel = data[0] as Channel;
  const timestamp = Number(view.getBigUint64(1, false));
  const payload = data.slice(HEADER_SIZE);

  if (!(channel in CHANNEL_NAMES)) {
    throw new Error(`Invalid channel: ${channel}`);
  }

  return { channel, timestamp, payload };
}

// Helper: encode a JSON payload for a control/event frame
export function encodeJsonFrame(
  channel: Channel.Control | Channel.Events,
  data: unknown,
): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(data));
  return encodeFrame(channel, payload);
}

// Helper: encode raw terminal data
export function encodeTerminalFrame(data: string | Uint8Array): Uint8Array {
  const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return encodeFrame(Channel.Terminal, payload);
}

// Helper: decode a JSON payload from a control/event frame
export function decodeJsonFrame<T = unknown>(frame: { channel: Channel; payload: Uint8Array }): T {
  const text = new TextDecoder().decode(frame.payload);
  return JSON.parse(text) as T;
}
