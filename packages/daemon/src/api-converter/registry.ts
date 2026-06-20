import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ApiProviderConfigSchema,
  EMPTY_API_PROVIDER_CONFIG,
  type ApiProviderConfig,
  type ApiProviderProfile,
} from '@baton/shared';

function getBatonHome(): string {
  return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
}

async function getConfigPath(): Promise<string> {
  const home = getBatonHome();
  await mkdir(home, { recursive: true });
  return join(home, 'api-providers.json');
}

export class ApiProviderRegistry {
  private config: ApiProviderConfig = EMPTY_API_PROVIDER_CONFIG;
  private loaded = false;

  async load(): Promise<void> {
    try {
      const path = await getConfigPath();
      const data = await readFile(path, 'utf-8');
      this.config = ApiProviderConfigSchema.parse(JSON.parse(data));
    } catch {
      this.config = { ...EMPTY_API_PROVIDER_CONFIG };
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    const path = await getConfigPath();
    await writeFile(path, JSON.stringify(this.config, null, 2));
  }

  list(): Array<{ name: string } & ApiProviderProfile> {
    return Object.entries(this.config.providers).map(([name, profile]) => ({
      name,
      ...profile,
    }));
  }

  listEnabled(): Array<{ name: string } & ApiProviderProfile> {
    return this.list().filter((p) => p.enabled);
  }

  get(name: string): ApiProviderProfile | undefined {
    return this.config.providers[name];
  }

  async set(name: string, profile: ApiProviderProfile): Promise<void> {
    if (profile.isDefault) {
      for (const [key, val] of Object.entries(this.config.providers)) {
        if (key !== name) val.isDefault = false;
      }
    }
    this.config.providers[name] = profile;
    await this.save();
  }

  async remove(name: string): Promise<boolean> {
    if (!(name in this.config.providers)) return false;
    const wasDefault = this.config.providers[name].isDefault;
    delete this.config.providers[name];
    if (wasDefault) {
      const remaining = Object.keys(this.config.providers);
      if (remaining.length > 0) {
        this.config.providers[remaining[0]].isDefault = true;
      }
    }
    await this.save();
    return true;
  }

  getDefault(): { name: string } & ApiProviderProfile | undefined {
    return this.list().find((p) => p.isDefault) ?? this.list()[0];
  }

  ensureLoaded(): boolean {
    return this.loaded;
  }
}
