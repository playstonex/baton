import { useState, useEffect, useCallback } from 'react';
import { Button, Input } from '@heroui/react';
import { PageHeader, SectionHeader, Card, EmptyState, StatusBadge } from '../lib/ui.js';
import { IconServer } from '../lib/icons.js';

interface ApiProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  createdAt?: string;
}

export function ApiProvidersScreen() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newModels, setNewModels] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);

  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModels, setEditModels] = useState('');
  const [editEnabled, setEditEnabled] = useState(false);
  const [editIsDefault, setEditIsDefault] = useState(false);

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
    if (!newName.trim() || !newBaseUrl.trim() || !newApiKey.trim()) return;
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
          apiKey: newApiKey.trim(),
          models,
          enabled: true,
          isDefault: newIsDefault,
        }),
      });
      if (res.ok) {
        setNewName('');
        setNewBaseUrl('');
        setNewApiKey('');
        setNewModels('');
        setNewIsDefault(false);
        setStatus({ type: 'success', message: `Provider "${newName.trim()}" added` });
        await fetchProviders();
      } else {
        setStatus({ type: 'error', message: 'Failed to add provider' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to add provider' });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: ApiProvider) {
    setEditingName(p.name);
    setEditBaseUrl(p.baseUrl);
    setEditApiKey(p.apiKey);
    setEditModels(p.models.join(', '));
    setEditEnabled(p.enabled);
    setEditIsDefault(p.isDefault);
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
          apiKey: editApiKey.trim(),
          models,
          enabled: editEnabled,
          isDefault: editIsDefault,
        }),
      });
      if (res.ok) {
        setEditingName(null);
        setStatus({ type: 'success', message: `Provider "${name}" updated` });
        await fetchProviders();
      } else {
        setStatus({ type: 'error', message: 'Failed to update provider' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to update provider' });
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
        setStatus({ type: 'error', message: 'Failed to delete provider' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to delete provider' });
    }
  }

  return (
    <div>
      <PageHeader
        title="API Providers"
        description="Configure API service providers for the Chat Completions to Responses API converter proxy"
      />

      {status && (
        <div className="mb-6">
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              status.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/25 dark:text-green-400'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/25 dark:text-red-400'
            }`}
          >
            {status.message}
          </div>
        </div>
      )}

      <Card className="mb-10">
        <SectionHeader title="New Provider" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              Name
            </label>
            <Input
              placeholder="e.g. openai, azure-east"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              Base URL
            </label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={newBaseUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewBaseUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              API Key
            </label>
            <Input
              type="password"
              placeholder="sk-..."
              value={newApiKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewApiKey(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              Models (comma-separated)
            </label>
            <Input
              placeholder="gpt-4o, gpt-4o-mini"
              value={newModels}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewModels(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={newIsDefault}
              onChange={(e) => setNewIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            />
            Set as default
          </label>
          <Button
            variant="primary"
            size="sm"
            onPress={addProvider}
            isDisabled={creating || !newName.trim() || !newBaseUrl.trim() || !newApiKey.trim()}
            className="ml-auto"
          >
            {creating ? 'Adding...' : 'Add Provider'}
          </Button>
        </div>
      </Card>

      <SectionHeader title="All Providers" count={providers.length} />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<IconServer className="h-7 w-7 text-gray-400" />}
          title="No API providers configured"
          description="Add one above to start using the converter proxy."
        />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const isEditing = editingName === p.name;
            const maskedKey = p.apiKey.length > 8 ? `${p.apiKey.slice(0, 8)}••••` : p.apiKey;

            return (
              <Card key={p.name}>
                {isEditing ? (
                  <div>
                    <div className="mb-5 flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {p.name}
                      </span>
                      <StatusBadge status="starting" />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                          Base URL
                        </label>
                        <Input
                          value={editBaseUrl}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditBaseUrl(e.target.value)
                          }
                          className="font-mono text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                          API Key
                        </label>
                        <Input
                          type="password"
                          value={editApiKey}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditApiKey(e.target.value)
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
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

                    <div className="mt-4 flex items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                        <input
                          type="checkbox"
                          checked={editEnabled}
                          onChange={(e) => setEditEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                        />
                        Enabled
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                        <input
                          type="checkbox"
                          checked={editIsDefault}
                          onChange={(e) => setEditIsDefault(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                        />
                        Default
                      </label>
                    </div>

                    <div className="mt-5 flex justify-end gap-2">
                      <Button size="sm" variant="outline" onPress={cancelEdit}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onPress={() => saveEdit(p.name)}
                        isDisabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {p.name}
                        </span>
                        {p.isDefault && (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                            default
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
                            p.enabled
                              ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              p.enabled ? 'bg-green-500' : 'bg-gray-400'
                            }`}
                          />
                          {p.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() => startEdit(p)}
                          isDisabled={editingName !== null}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          onPress={() => deleteProvider(p.name)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-gray-400">Base URL</span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                          {p.baseUrl}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-gray-400">API Key</span>
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                          {maskedKey}
                        </span>
                      </div>
                    </div>

                    {p.models.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.models.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
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
