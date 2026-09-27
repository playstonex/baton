import * as SecureStore from 'expo-secure-store';

// ── Legacy single-host keys (pre-multi-host) ─────────────────────
// Kept only for one-time migration. New code uses HOSTS / ACTIVE_HOST.
const LEGACY_KEYS = {
  MODE: 'fw_mode',
  RELAY_URL: 'fw_relay_url',
  HOST_ID: 'fw_host_id',
  TOKEN: 'fw_token',
  LOCAL_HTTP: 'fw_local_http',
  LOCAL_WS: 'fw_local_ws',
} as const;

// ── Multi-host keys ──────────────────────────────────────────────
const HOSTS_KEY = 'fw_hosts';
const ACTIVE_HOST_KEY = 'fw_active_host';

export interface HostProfile {
  /** Stable id (uuid). Used as the switch key. */
  id: string;
  /** Human label shown in the host switcher. */
  label: string;
  mode: 'local' | 'remote';
  relayUrl?: string;
  hostId?: string;
  token?: string;
  localHttpUrl?: string;
  localWsUrl?: string;
  addedAt: number;
  lastUsed: number;
}

/** Backward-compat shape consumed by wsService.configure(). */
export interface SavedConnection {
  mode: 'local' | 'remote';
  relayUrl?: string;
  hostId?: string;
  token?: string;
  localHttpUrl?: string;
  localWsUrl?: string;
}

export function hostToConnection(h: HostProfile): SavedConnection {
  return {
    mode: h.mode,
    relayUrl: h.relayUrl,
    hostId: h.hostId,
    token: h.token,
    localHttpUrl: h.localHttpUrl,
    localWsUrl: h.localWsUrl,
  };
}

function deriveLabel(h: SavedConnection): string {
  return h.mode === 'local' ? h.localHttpUrl || 'Local daemon' : h.relayUrl || 'Remote daemon';
}

function generateHostId(): string {
  // Lightweight uuid without a dependency.
  return 'h_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ── Migration: legacy single-host → hosts array ──────────────────

/**
 * One-time migration: if the legacy single-host keys exist and no hosts array
 * is present yet, convert the single host into a one-entry HostProfile[],
 * mark it active, then delete the legacy keys. Idempotent — a no-op once the
 * new keys exist.
 */
export async function migrateLegacyCredentialsIfNeeded(): Promise<void> {
  const existing = await SecureStore.getItemAsync(HOSTS_KEY);
  if (existing) return; // already migrated (or new install)

  const mode = await SecureStore.getItemAsync(LEGACY_KEYS.MODE);
  if (!mode) return; // nothing to migrate

  const legacy: SavedConnection = {
    mode: mode as 'local' | 'remote',
    relayUrl: (await SecureStore.getItemAsync(LEGACY_KEYS.RELAY_URL)) ?? undefined,
    hostId: (await SecureStore.getItemAsync(LEGACY_KEYS.HOST_ID)) ?? undefined,
    token: (await SecureStore.getItemAsync(LEGACY_KEYS.TOKEN)) ?? undefined,
    localHttpUrl: (await SecureStore.getItemAsync(LEGACY_KEYS.LOCAL_HTTP)) ?? undefined,
    localWsUrl: (await SecureStore.getItemAsync(LEGACY_KEYS.LOCAL_WS)) ?? undefined,
  };

  const host: HostProfile = {
    id: generateHostId(),
    label: deriveLabel(legacy),
    ...legacy,
    addedAt: Date.now(),
    lastUsed: Date.now(),
  };

  await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify([host]));
  await SecureStore.setItemAsync(ACTIVE_HOST_KEY, host.id);

  // Clean up legacy keys.
  for (const key of Object.values(LEGACY_KEYS)) {
    await SecureStore.deleteItemAsync(key);
  }
}

// ── Multi-host API ───────────────────────────────────────────────

export async function loadHosts(): Promise<HostProfile[]> {
  try {
    const raw = await SecureStore.getItemAsync(HOSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HostProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHosts(hosts: HostProfile[]): Promise<void> {
  await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(hosts));
}

export async function getActiveHostId(): Promise<string | null> {
  return (await SecureStore.getItemAsync(ACTIVE_HOST_KEY)) ?? null;
}

export async function setActiveHostId(id: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_HOST_KEY, id);
}

/**
 * Add a host (or update if an equivalent one exists by connection identity),
 * set it active, and persist. Returns the host profile.
 */
export async function addHost(config: SavedConnection): Promise<HostProfile> {
  const hosts = await loadHosts();

  // De-dupe by identity: local → localHttpUrl, remote → relayUrl.
  const existingIdx = hosts.findIndex((h) => {
    if (config.mode === 'local')
      return h.mode === 'local' && h.localHttpUrl === config.localHttpUrl;
    return h.mode === 'remote' && h.relayUrl === config.relayUrl;
  });

  let host: HostProfile;
  if (existingIdx >= 0) {
    host = {
      ...hosts[existingIdx],
      ...config,
      label: deriveLabel(config),
      lastUsed: Date.now(),
    };
    hosts[existingIdx] = host;
  } else {
    host = {
      id: generateHostId(),
      label: deriveLabel(config),
      ...config,
      addedAt: Date.now(),
      lastUsed: Date.now(),
    };
    hosts.unshift(host);
  }

  await saveHosts(hosts);
  await setActiveHostId(host.id);
  return host;
}

export async function removeHost(id: string): Promise<void> {
  const hosts = (await loadHosts()).filter((h) => h.id !== id);
  await saveHosts(hosts);
  const active = await getActiveHostId();
  if (active === id) {
    await setActiveHostId(hosts[0]?.id ?? '');
  }
}

/**
 * Mark a host as the active one and bump its lastUsed timestamp. Returns the
 * updated list so callers can refresh their store in the same tick.
 */
export async function touchHost(id: string): Promise<HostProfile[]> {
  const hosts = await loadHosts();
  const now = Date.now();
  const updated = hosts.map((h) => (h.id === id ? { ...h, lastUsed: now } : h));
  await saveHosts(updated);
  await setActiveHostId(id);
  return updated;
}

/** Return the active host profile, or null if none configured. */
export async function loadActiveHost(): Promise<HostProfile | null> {
  const hosts = await loadHosts();
  if (hosts.length === 0) return null;
  const activeId = await getActiveHostId();
  return hosts.find((h) => h.id === activeId) ?? hosts[0];
}

// ── Legacy backward-compat shims ─────────────────────────────────
// These map onto the active host so existing call sites keep working.

export async function saveCredentials(config: SavedConnection): Promise<void> {
  await addHost(config);
}

export async function loadCredentials(): Promise<SavedConnection | null> {
  const host = await loadActiveHost();
  return host ? hostToConnection(host) : null;
}

export async function clearCredentials(): Promise<void> {
  await saveHosts([]);
  await SecureStore.deleteItemAsync(ACTIVE_HOST_KEY);
  // Also clear any stragglers from a pre-migration install.
  for (const key of Object.values(LEGACY_KEYS)) {
    await SecureStore.deleteItemAsync(key);
  }
}
