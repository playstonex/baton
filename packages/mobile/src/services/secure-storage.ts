import * as SecureStore from 'expo-secure-store';

export interface SavedConnection {
  mode: 'local' | 'remote';
  relayUrl?: string;
  hostId?: string;
  token?: string;
  localHttpUrl?: string;
  localWsUrl?: string;
}

const KEYS = {
  MODE: 'fw_mode',
  RELAY_URL: 'fw_relay_url',
  HOST_ID: 'fw_host_id',
  TOKEN: 'fw_token',
  LOCAL_HTTP: 'fw_local_http',
  LOCAL_WS: 'fw_local_ws',
};

export async function saveCredentials(config: SavedConnection): Promise<void> {
  await SecureStore.setItemAsync(KEYS.MODE, config.mode);
  if (config.relayUrl) await SecureStore.setItemAsync(KEYS.RELAY_URL, config.relayUrl);
  if (config.hostId) await SecureStore.setItemAsync(KEYS.HOST_ID, config.hostId);
  if (config.token) await SecureStore.setItemAsync(KEYS.TOKEN, config.token);
  if (config.localHttpUrl) await SecureStore.setItemAsync(KEYS.LOCAL_HTTP, config.localHttpUrl);
  if (config.localWsUrl) await SecureStore.setItemAsync(KEYS.LOCAL_WS, config.localWsUrl);
}

export async function loadCredentials(): Promise<SavedConnection | null> {
  const mode = await SecureStore.getItemAsync(KEYS.MODE);
  if (!mode) return null;

  const [relayUrl, hostId, token, localHttpUrl, localWsUrl] = await Promise.all([
    SecureStore.getItemAsync(KEYS.RELAY_URL),
    SecureStore.getItemAsync(KEYS.HOST_ID),
    SecureStore.getItemAsync(KEYS.TOKEN),
    SecureStore.getItemAsync(KEYS.LOCAL_HTTP),
    SecureStore.getItemAsync(KEYS.LOCAL_WS),
  ]);

  return {
    mode: mode as 'local' | 'remote',
    relayUrl: relayUrl ?? undefined,
    hostId: hostId ?? undefined,
    token: token ?? undefined,
    localHttpUrl: localHttpUrl ?? undefined,
    localWsUrl: localWsUrl ?? undefined,
  };
}

export async function clearCredentials(): Promise<void> {
  for (const key of Object.values(KEYS)) {
    await SecureStore.deleteItemAsync(key);
  }
}
