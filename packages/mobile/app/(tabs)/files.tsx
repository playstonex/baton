import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../src/stores/agents';
import { apiFetch } from '../../src/services/api';
import { FilePreview } from '../../src/components/FilePreview';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export default function FilesScreen() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status !== 'stopped');

  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeAgents.length > 0 && currentPath === '/') {
      fetchDir(activeAgents[0].projectPath);
    }
  }, [activeAgents, currentPath]);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ path: string; items: FileEntry[] }>(`/api/files?path=${encodeURIComponent(path)}`);
      setItems(data.items ?? []);
      setCurrentPath(path);
      setFileContent(null);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  async function openFile(path: string) {
    try {
      const data = await apiFetch<{ content: string; name: string }>(`/api/files/content?path=${encodeURIComponent(path)}`);
      setFileContent(data.content);
      setFileName(data.name);
    } catch {
      // ignore
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean);

  if (fileContent !== null) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#fff' }}>
          <TouchableOpacity onPress={() => setFileContent(null)}>
            <Text style={{ color: '#2563eb', fontSize: 14 }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ flex: 1, marginLeft: 12, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>{fileName}</Text>
        </View>
        <FilePreview fileName={fileName} content={fileContent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Breadcrumb */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 2, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <TouchableOpacity onPress={() => fetchDir('/')}>
          <Text style={{ color: '#6b7280', fontSize: 13, fontFamily: 'monospace' }}>/</Text>
        </TouchableOpacity>
        {pathParts.map((part, i) => {
          const path = '/' + pathParts.slice(0, i + 1).join('/');
          return (
            <View key={path} style={{ flexDirection: 'row' }}>
              <Text style={{ color: '#d1d5db', fontSize: 13 }}>/</Text>
              <TouchableOpacity onPress={() => fetchDir(path)}>
                <Text style={{ color: i === pathParts.length - 1 ? '#2563eb' : '#6b7280', fontSize: 13, fontFamily: 'monospace', fontWeight: i === pathParts.length - 1 ? '600' : '400' }}>
                  {part}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* Agent project shortcuts */}
      {activeAgents.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 8 }}>
          {activeAgents.map((a) => (
            <TouchableOpacity key={a.id} onPress={() => fetchDir(a.projectPath)} style={{ padding: 4, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>{a.projectPath.split('/').pop()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* File list */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.path}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={
            <View style={{ padding: 30, alignItems: 'center' }}>
              <Text style={{ color: '#9ca3af' }}>Empty directory</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => (item.isDir ? fetchDir(item.path) : openFile(item.path))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}
            >
              <Text style={{ fontSize: 14, color: item.isDir ? '#2563eb' : '#9ca3af' }}>{item.isDir ? '📁' : '📄'}</Text>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', fontWeight: item.isDir ? '500' : '400' }} numberOfLines={1}>{item.name}</Text>
              {!item.isDir && <Text style={{ fontSize: 11, color: '#d1d5db' }}>{formatSize(item.size)}</Text>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
