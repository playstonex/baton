import { StyleSheet } from 'react-native';
import { View, Text, FlatList } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Chip, Spinner } from 'heroui-native';
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
    if (activeAgents.length > 0 && currentPath === '/') fetchDir(activeAgents[0].projectPath);
  }, [activeAgents, currentPath]);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ path: string; items: FileEntry[] }>(`/api/files?path=${encodeURIComponent(path)}`);
      setItems(data.items ?? []); setCurrentPath(path); setFileContent(null);
    } catch { /* offline */ } finally { setLoading(false); }
  }, []);

  async function openFile(path: string) {
    try {
      const data = await apiFetch<{ content: string; name: string }>(`/api/files/content?path=${encodeURIComponent(path)}`);
      setFileContent(data.content); setFileName(data.name);
    } catch { /* offline */ }
  }

  const pathParts = currentPath.split('/').filter(Boolean);

  if (fileContent !== null) {
    return (
      <View style={s.container}>
        <View style={s.fileHeader}>
          <Button variant="ghost" size="sm" onPress={() => setFileContent(null)}>Back</Button>
          <Text style={s.fileNameText} numberOfLines={1}>{fileName}</Text>
        </View>
        <FilePreview fileName={fileName} content={fileContent} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.breadcrumb}>
        <Button variant="ghost" size="sm" onPress={() => fetchDir('/')}>
          <Text style={s.bcPart}>/</Text>
        </Button>
        {pathParts.map((part, i) => {
          const path = '/' + pathParts.slice(0, i + 1).join('/');
          return (
            <View key={path} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={s.bcSlash}>/</Text>
              <Button variant="ghost" size="sm" onPress={() => fetchDir(path)}>
                <Text style={[s.bcPart, i === pathParts.length - 1 && s.bcActive]}>{part}</Text>
              </Button>
            </View>
          );
        })}
      </View>

      {activeAgents.length > 0 && (
        <View style={s.shortcuts}>
          {activeAgents.map((a) => (
            <Chip
              key={a.id}
              variant={currentPath === a.projectPath ? 'primary' : 'tertiary'}
              color={currentPath === a.projectPath ? 'accent' : 'default'}
              onPress={() => fetchDir(a.projectPath)}
              size="sm"
            >
              {a.projectPath.split('/').pop()}
            </Chip>
          ))}
        </View>
      )}

      {loading ? (
        <View style={s.empty}><Spinner size="lg" /></View>
      ) : (
        <FlatList data={items} keyExtractor={(item) => item.path} contentContainerStyle={s.list}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>Empty directory</Text></View>}
          renderItem={({ item }) => (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => (item.isDir ? fetchDir(item.path) : openFile(item.path))}
              style={s.fileRow}
            >
              <Text style={[s.fileIcon, { color: item.isDir ? '#60a5fa' : '#6b7280' }]}>{item.isDir ? '\u{1F4C1}' : '\u{1F4C4}'}</Text>
              <Text style={[s.fileMono, item.isDir && { fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
              {!item.isDir && <Text style={s.fileSize}>{fmt(item.size)}</Text>}
            </Button>
          )}
        />
      )}
    </View>
  );
}

function fmt(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  fileHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e26', backgroundColor: '#141419' },
  fileNameText: { flex: 1, marginLeft: 12, fontWeight: '600', fontSize: 14, color: '#fff' },
  breadcrumb: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 2, borderBottomWidth: 1, borderBottomColor: '#1e1e26', backgroundColor: '#141419' },
  bcPart: { color: '#6b7280', fontSize: 13, fontFamily: 'monospace' },
  bcSlash: { color: '#252530', fontSize: 13, fontFamily: 'monospace' },
  bcActive: { color: '#60a5fa', fontWeight: '600' },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#141419' },
  list: { padding: 12 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#6b7280' },
  fileRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e26' },
  fileIcon: { fontSize: 16, width: 24, textAlign: 'center' },
  fileMono: { flex: 1, fontSize: 13, fontFamily: 'monospace', color: '#d1d5db' },
  fileSize: { fontSize: 11, color: '#4b5563' },
});
