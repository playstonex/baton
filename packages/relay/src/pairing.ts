import { randomBytes } from 'node:crypto';

const PAIRING_CODE_TTL = 5 * 60 * 1000;

interface PendingPairing {
  code: string;
  hostId: string;
  hostPublicKeyFingerprint: string;
  createdAt: number;
}

export class PairingService {
  private pending = new Map<string, PendingPairing>();

  createCode(hostId: string, hostPublicKeyFingerprint: string): string {
    this.cleanExpired();

    const code = randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
    this.pending.set(code, {
      code,
      hostId,
      hostPublicKeyFingerprint,
      createdAt: Date.now(),
    });
    return code;
  }

  redeem(code: string): { hostId: string; hostPublicKeyFingerprint: string } | null {
    const pairing = this.pending.get(code.toUpperCase());
    if (!pairing) return null;
    if (Date.now() - pairing.createdAt > PAIRING_CODE_TTL) {
      this.pending.delete(code);
      return null;
    }
    this.pending.delete(pairing.code);
    return { hostId: pairing.hostId, hostPublicKeyFingerprint: pairing.hostPublicKeyFingerprint };
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [code, pairing] of this.pending) {
      if (now - pairing.createdAt > PAIRING_CODE_TTL) {
        this.pending.delete(code);
      }
    }
  }
}
