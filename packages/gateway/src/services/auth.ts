import { SignJWT, jwtVerify } from 'jose';
import { randomInt } from 'node:crypto';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? (() => {
    throw new Error('JWT_SECRET environment variable is required');
  })(),
);

const JWT_ISSUER = 'baton';
const JWT_AUDIENCE = 'baton-relay';

export interface TokenPayload {
  sub: string; // hostId or userId
  role: 'host' | 'client';
  hostId?: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, hostId: payload.hostId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return {
      sub: payload.sub ?? '',
      role: (payload.role as 'host' | 'client') ?? 'client',
      hostId: payload.hostId as string | undefined,
    };
  } catch {
    return null;
  }
}

export function generatePairingCode(): string {
  return randomInt(100000, 1000000).toString();
}
