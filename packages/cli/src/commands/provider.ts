import { apiFetch } from '../client/api.js';

export async function providerCommand(sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case 'ls':
    case 'list':
      await providerList();
      break;
    case 'models':
      await providerModels(args[0]);
      break;
    default:
      console.log(`Usage: flowwhips provider <ls|models>`);
  }
}

async function providerList(): Promise<void> {
  try {
    const agents =
      await apiFetch<Array<{ id: string; type: string; status: string; projectPath: string }>>(
        '/api/agents',
      );
    const types = [...new Set(agents.map((a) => a.type))];
    console.log('Available providers:');
    for (const t of types.length ? types : ['claude-code', 'codex', 'opencode']) {
      console.log(`  ${t}`);
    }
  } catch {
    console.log('Available providers:');
    console.log('  claude-code');
    console.log('  codex');
    console.log('  opencode');
  }
}

async function providerModels(_provider?: string): Promise<void> {
  console.log('Provider models: requires daemon connection with provider config.');
  console.log('Configure providers in ~/.flowwhips/providers.json');
}
