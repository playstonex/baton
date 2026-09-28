import { useState, useEffect, useCallback } from 'react';
import {
  PageHeader,
  SectionHeader,
  Card,
  EmptyState,
  StatusBadge,
  Button,
  Input,
  SegmentedControl,
} from '../lib/ui.js';
import { IconServer } from '../lib/icons.js';

interface ApiProvider {
  name: string;
  baseUrl: string;
  envKey: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  apiMode: 'responses' | 'chat';
  upstreamFormat: 'responses' | 'openai-chat' | 'anthropic';
  createdAt?: string;
}

type UpstreamFormat = ApiProvider['upstreamFormat'];

const UPSTREAM_FORMATS: { key: UpstreamFormat; label: string; hint: string }[] = [
  {
    key: 'openai-chat',
    label: 'OpenAI Chat',
    hint: 'Upstream speaks Chat Completions (/chat/completions) — daemon converts Responses ↔ Chat. Most third-party OpenAI-compatible providers (GLM, DeepSeek, Moonshot, Qwen, etc.) use this.',
  },
  {
    key: 'responses',
    label: 'Responses',
    hint: 'Upstream speaks the OpenAI Responses API natively (/responses) — passthrough, no conversion. Only OpenAI itself and a few gateways expose this.',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    hint: 'Upstream speaks the Anthropic Messages API (/v1/messages) — daemon converts Responses ↔ Messages.',
  },
];

const FORMAT_OPTIONS = UPSTREAM_FORMATS.map((f) => ({ key: f.key, label: f.label }));

/**
 * Pick a sensible default `upstreamFormat` from the provider's base URL.
 */
function guessUpstreamFormat(baseUrl: string): UpstreamFormat {
  const u = baseUrl.toLowerCase();
  if (u.includes('anthropic.com')) return 'anthropic';
  if (u.includes('api.openai.com')) return 'responses';
  return 'openai-chat';
}

const UPSTREAM_BADGE_STYLES: Record<UpstreamFormat, string> = {
  responses:
    'bg-geist-blue-100 text-geist-blue-700 dark:bg-geist-blue-1000 dark:text-geist-blue-900',
  'openai-chat': 'bg-geist-gray-alpha-200 text-geist-gray-900',
  anthropic:
    'bg-geist-amber-100 text-geist-amber-900 dark:bg-geist-amber-1000 dark:text-geist-amber-600',
};

export function ApiProvidersScreen() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function extractError(res: Response, fallback: string): Promise<string> {
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string' && body.error) return body.error;
      if (body && typeof body.message === 'string' && body.message) return body.message;
      return `${fallback} (HTTP ${res.status})`;
    } catch {
      try {
        const text = await res.text();
        return text || `${fallback} (HTTP ${res.status})`;
      } catch {
        return `${fallback} (HTTP ${res.status})`;
      }
    }
  }

  function formatError(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return `${fallback}: ${err.message}`;
    return fallback;
  }

  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newModels, setNewModels] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [newUpstreamFormat, setNewUpstreamFormat] = useState<UpstreamFormat>('openai-chat');
  const [newFormatTouched, setNewFormatTouched] = useState(false);

  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editEnvKey, setEditEnvKey] = useState('');
  const [editModels, setEditModels] = useState('');
  const [editEnabled, setEditEnabled] = useState(false);
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editUpstreamFormat, setEditUpstreamFormat] = useState<UpstreamFormat>('responses');

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/api-providers');
      if (res.ok) setProviders((await res.json()) as ApiProvider[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  async function addProvider() {
    if (!newName.trim() || !newBaseUrl.trim()) return;
    setCreating(true);
    try {
      const models = newModels
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      const res = await fetch('/api/api-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          baseUrl: newBaseUrl.trim(),
          envKey: newEnvKey.trim() || 'OPENAI_API_KEY',
          models,
          enabled: true,
          isDefault: newIsDefault,
          upstreamFormat: newUpstreamFormat,
        }),
      });
      if (res.ok) {
        setNewName('');
        setNewBaseUrl('');
        setNewEnvKey('');
        setNewModels('');
        setNewIsDefault(false);
        setNewUpstreamFormat('openai-chat');
        setNewFormatTouched(false);
        setStatus({ type: 'success', message: `Provider "${newName.trim()}" added` });
        await fetchProviders();
      } else {
        const msg = await extractError(res, 'Failed to add provider');
        setStatus({ type: 'error', message: msg });
      }
    } catch (err) {
      setStatus({ type: 'error', message: formatError(err, 'Failed to add provider') });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: ApiProvider) {
    setEditingName(p.name);
    setEditBaseUrl(p.baseUrl);
    setEditEnvKey(p.envKey ?? 'OPENAI_API_KEY');
    setEditModels(p.models.join(', '));
    setEditEnabled(p.enabled);
    setEditIsDefault(p.isDefault);
    setEditUpstreamFormat(p.upstreamFormat ?? 'responses');
  }

  function cancelEdit() {
    setEditingName(null);
  }

  async function saveEdit(name: string) {
    setSaving(true);
    try {
      const models = editModels
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      const res = await fetch(`/api/api-providers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: editBaseUrl.trim(),
          envKey: editEnvKey.trim() || 'OPENAI_API_KEY',
          models,
          enabled: editEnabled,
          isDefault: editIsDefault,
          upstreamFormat: editUpstreamFormat,
        }),
      });
      if (res.ok) {
        setEditingName(null);
        setStatus({ type: 'success', message: `Provider "${name}" updated` });
        await fetchProviders();
      } else {
        const msg = await extractError(res, 'Failed to update provider');
        setStatus({ type: 'error', message: msg });
      }
    } catch (err) {
      setStatus({ type: 'error', message: formatError(err, 'Failed to update provider') });
    } finally {
      setSaving(false);
    }
  }

  async function deleteProvider(name: string) {
    try {
      const res = await fetch(`/api/api-providers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setStatus({ type: 'success', message: `Provider "${name}" deleted` });
        await fetchProviders();
      } else {
        const msg = await extractError(res, 'Failed to delete provider');
        setStatus({ type: 'error', message: msg });
      }
    } catch (err) {
      setStatus({ type: 'error', message: formatError(err, 'Failed to delete provider') });
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="API Providers"
        description="Configure upstream providers for Codex. The daemon proxies Codex's Responses-API requests and adapts them to each provider's format (OpenAI Chat / Anthropic / Responses). Codex's config.toml is auto-synced to point at the local daemon."
      />

      {status && (
        <div
          className={`rounded-[var(--radius-sm)] border px-4 py-3 text-sm ${
            status.type === 'success'
              ? 'border-geist-green-100 bg-geist-green-100 text-geist-green-900 dark:border-geist-green-1000 dark:bg-geist-green-1000 dark:text-geist-green-900'
              : 'border-geist-red-100 bg-geist-red-100 text-geist-red-900 dark:border-geist-red-1000 dark:bg-geist-red-1000 dark:text-geist-red-900'
          }`}
        >
          {status.message}
        </div>
      )}

      <Card>
        <SectionHeader title="New Provider" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">Name</label>
            <Input
              placeholder="e.g. openai, azure-east"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">Base URL</label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={newBaseUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = e.target.value;
                setNewBaseUrl(v);
                if (!newFormatTouched && v.trim()) {
                  setNewUpstreamFormat(guessUpstreamFormat(v));
                }
              }}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">Env Key</label>
            <Input
              placeholder="OPENAI_API_KEY"
              value={newEnvKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEnvKey(e.target.value)}
              className="font-mono"
            />
            <p className="mt-1 text-[11px] text-geist-gray-700">
              Name of the env var holding the API key (Codex reads the key from here).
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
              Models (comma-separated)
            </label>
            <Input
              placeholder="gpt-4o, gpt-4o-mini"
              value={newModels}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewModels(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
            Upstream Format
          </label>
          <SegmentedControl
            value={newUpstreamFormat}
            options={FORMAT_OPTIONS}
            onChange={(m) => {
              setNewUpstreamFormat(m);
              setNewFormatTouched(true);
            }}
          />
          <p className="mt-1.5 text-xs text-geist-gray-700">
            {UPSTREAM_FORMATS.find((m) => m.key === newUpstreamFormat)?.hint}
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-geist-gray-800">
            <input
              type="checkbox"
              checked={newIsDefault}
              onChange={(e) => setNewIsDefault(e.target.checked)}
              className="h-4 w-4 rounded-[var(--radius-sm)] border-geist-gray-alpha-500 accent-geist-gray-1000"
            />
            Set as default
          </label>
          <Button
            variant="primary"
            size="sm"
            onClick={addProvider}
            disabled={creating || !newName.trim() || !newBaseUrl.trim()}
            className="ml-auto"
          >
            {creating ? 'Adding…' : 'Add Provider'}
          </Button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-geist-gray-700">
          Codex talks Responses-API to the local daemon, which adapts to this provider's upstream
          format and forwards to <code className="font-mono">Base URL</code>. On save,
          <code className="font-mono"> ~/.codex/config.toml</code> is updated so this provider points
          at <code className="font-mono">http://localhost:3210/proxy</code>.
          <br />
          <strong className="font-medium text-geist-gray-800">API key:</strong> put it in
          <code className="font-mono"> ~/.baton/.env</code> (e.g.
          <code className="font-mono"> GLM_CODEX_API_KEY=sk-...</code>) — the daemon reads it from
          there on startup, so it works even when launched from the mobile app or on reboot. Restart
          the daemon after editing.
        </p>
      </Card>

      <SectionHeader title="All Providers" count={providers.length} />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-geist-blue-700 border-t-transparent" />
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<IconServer className="h-7 w-7 text-geist-gray-700" />}
          title="No API providers configured"
          description="Add one above to start using the converter proxy."
        />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const isEditing = editingName === p.name;

            return (
              <Card key={p.name}>
                {isEditing ? (
                  <div>
                    <div className="mb-5 flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-geist-gray-1000">{p.name}</span>
                      <StatusBadge status="starting" />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
                          Base URL
                        </label>
                        <Input
                          value={editBaseUrl}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditBaseUrl(e.target.value)
                          }
                          className="font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
                          Env Key
                        </label>
                        <Input
                          value={editEnvKey}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditEnvKey(e.target.value)
                          }
                          className="font-mono"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
                          Models (comma-separated)
                        </label>
                        <Input
                          value={editModels}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditModels(e.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
                        Upstream Format
                      </label>
                      <SegmentedControl
                        value={editUpstreamFormat}
                        options={FORMAT_OPTIONS}
                        onChange={setEditUpstreamFormat}
                      />
                    </div>

                    <div className="mt-4 flex items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-geist-gray-800">
                        <input
                          type="checkbox"
                          checked={editEnabled}
                          onChange={(e) => setEditEnabled(e.target.checked)}
                          className="h-4 w-4 rounded-[var(--radius-sm)] border-geist-gray-alpha-500 accent-geist-gray-1000"
                        />
                        Enabled
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-geist-gray-800">
                        <input
                          type="checkbox"
                          checked={editIsDefault}
                          onChange={(e) => setEditIsDefault(e.target.checked)}
                          className="h-4 w-4 rounded-[var(--radius-sm)] border-geist-gray-alpha-500 accent-geist-gray-1000"
                        />
                        Default
                      </label>
                    </div>

                    <div className="mt-5 flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={cancelEdit}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => saveEdit(p.name)}
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-geist-gray-1000">{p.name}</span>
                        {p.isDefault && (
                          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-geist-gray-1000 px-2 py-0.5 text-xs font-medium text-geist-background-100">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-geist-background-100" />
                            default
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${
                            p.enabled
                              ? 'bg-geist-green-100 text-geist-green-700 dark:bg-geist-green-1000 dark:text-geist-green-900'
                              : 'bg-geist-gray-alpha-200 text-geist-gray-900'
                          }`}
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              p.enabled ? 'bg-geist-green-600' : 'bg-geist-gray-500'
                            }`}
                          />
                          {p.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => startEdit(p)}
                          disabled={editingName !== null}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="error"
                          onClick={() => deleteProvider(p.name)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-geist-gray-700">Base URL</span>
                        <span className="font-mono text-xs text-geist-gray-900">{p.baseUrl}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-geist-gray-700">Env Key</span>
                        <span className="font-mono text-xs text-geist-gray-900">
                          {p.envKey ?? 'OPENAI_API_KEY'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-geist-gray-700">Upstream</span>
                        <span
                          className={`inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${UPSTREAM_BADGE_STYLES[p.upstreamFormat ?? 'responses']}`}
                        >
                          {UPSTREAM_FORMATS.find((m) => m.key === (p.upstreamFormat ?? 'responses'))
                            ?.label ?? p.upstreamFormat}
                        </span>
                      </div>
                    </div>

                    {p.models.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.models.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center rounded-[var(--radius-sm)] bg-geist-gray-alpha-200 px-2 py-0.5 text-xs font-medium text-geist-gray-900"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
