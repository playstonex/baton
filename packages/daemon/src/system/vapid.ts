/**
 * VAPID key management for Web Push (RFC 8292).
 *
 * Generates and persists an ECDSA P-256 key pair on first use at
 * `$BATON_HOME/vapid.json`. The public key (uncompressed, base64url) is
 * handed to browser clients so they can create a PushSubscription scoped to
 * this daemon as the application server.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function batonHome(): string {
  return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
}

function vapidFile(): string {
  return join(batonHome(), 'vapid.json');
}

let cachedKeys: VapidKeys | null = null;

/**
 * Load VAPID keys from disk, generating a fresh pair on first run. Memoized
 * after the first load. Also configures the `web-push` library with the keys
 * and the subject (a mailto: or URL identifying the push source).
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;

  const file = vapidFile();
  if (existsSync(file)) {
    try {
      const raw = await readFile(file, 'utf-8');
      cachedKeys = JSON.parse(raw) as VapidKeys;
    } catch {
      // corrupt — regenerate
      cachedKeys = null;
    }
  }

  if (!cachedKeys) {
    const generated = webpush.generateVAPIDKeys();
    cachedKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };
    const dir = batonHome();
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(cachedKeys, null, 2), { mode: 0o600 });
    console.log('[Push] Generated new VAPID key pair at', file);
  }

  // Configure web-push for all subsequent sendNotification calls.
  webpush.setVapidDetails(
    process.env.BATON_VAPID_SUBJECT ?? 'mailto:daemon@baton.local',
    cachedKeys.publicKey,
    cachedKeys.privateKey,
  );

  return cachedKeys;
}

/**
 * Send a Web Push notification to a browser subscription.
 * @param subscription The PushSubscription JSON the browser created
 *   (endpoint + keys.p256dh + keys.auth).
 * @param payload The notification payload (will be encrypted per RFC 8291).
 */
export async function sendWebPush(
  subscription: webpush.PushSubscription,
  payload: unknown,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      // TTL: drop after 4 weeks if undeliverable. Urgency: normal.
      { TTL: 604800, urgency: 'normal' },
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 410 Gone / 404 = subscription no longer valid; caller should drop it.
    if (status === 410 || status === 404) {
      console.log(`[Push] Web subscription expired (${status}), will be cleaned up`);
    } else {
      console.error(`[Push] Web push failed (${status}):`, (err as Error).message);
    }
    return false;
  }
}

/** Parse a subscription token (JSON string) into a web-push subscription. */
export function parseSubscription(token: string): webpush.PushSubscription | null {
  try {
    const parsed = JSON.parse(token) as webpush.PushSubscription;
    if (parsed.endpoint && parsed.keys?.p256dh && parsed.keys?.auth) return parsed;
    return null;
  } catch {
    return null;
  }
}
