import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ProviderConfigSchema,
  EMPTY_PROVIDER_CONFIG,
  type ProviderConfig,
  type ProviderProfile,
} from '@flowwhips/shared';

function getFlowwhipsHome(): string {
  return process.env.FLOWWHIPS_HOME ?? `${process.env.HOME ?? '~'}/.flowwhips`;
}

async function getConfigPath(): Promise<string> {
  const home = getFlowwhipsHome();
  await mkdir(home, { recursive: true });
  return join(home, 'providers.json');
}

export class ProviderRegistry {
  private config: ProviderConfig = EMPTY_PROVIDER_CONFIG;
  private loaded = false;

  async load(): Promise<void> {
    try {
      const path = await getConfigPath();
      const data = await readFile(path, 'utf-8');
      this.config = ProviderConfigSchema.parse(JSON.parse(data));
    } catch {
      this.config = { ...EMPTY_PROVIDER_CONFIG };
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    const path = await getConfigPath();
    await writeFile(path, JSON.stringify(this.config, null, 2));
  }

  list(): Array<{ name: string } & ProviderProfile> {
    return Object.entries(this.config.providers).map(([name, profile]) => ({
      name,
      ...profile,
    }));
  }

  get(name: string): ProviderProfile | undefined {
    return this.config.providers[name];
  }

  async set(name: string, profile: ProviderProfile): Promise<void> {
    this.config.providers[name] = profile;
    await this.save();
  }

  async remove(name: string): Promise<boolean> {
    if (!(name in this.config.providers)) return false;
    delete this.config.providers[name];
    await this.save();
    return true;
  }

  has(name: string): boolean {
    return name in this.config.providers;
  }

  getDefaultProvider(type: string): string | undefined {
    for (const [name, profile] of Object.entries(this.config.providers)) {
      if (profile.type === type) return name;
    }
    return undefined;
  }

  ensureLoaded(): boolean {
    return this.loaded;
  }
}
