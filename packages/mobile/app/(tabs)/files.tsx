import { StyleSheet } from 'react-native';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { Spinner } from 'heroui-native';
import { useAgentStore } from '../../src/stores/agents';
import { apiFetch } from '../../src/services/api';
import { FilePreview } from '../../src/components/FilePreview';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { Colors, Typography, Spacing, CornerRadius, Radius } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';

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
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    if (activeAgents.length > 0 && currentPath === '/') fetchDir(activeAgents[0].projectPath);
  }, [activeAgents, currentPath]);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ path: string; items: FileEntry[] }>(`/api/files?path=${encodeURIComponent(path)}`);
      setItems(data.items ?? []);
      setCurrentPath(path);
      setFileContent(null);
    } catch {
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
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean);

  if (fileContent !== null) {
    return (
      <View style={[s.container, { backgroundColor: c.bg, paddingTop: headerHeight }]}>
        <View style={[s.previewHeader, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
          <Pressable onPress={() => setFileContent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[Typography.footnote, { color: Colors.primary[500], fontWeight: '500' }]}>
              {'\u2190'} Back
            </Text>
          </Pressable>
          <Text
            style={[Typography.headline, { color: c.textPrimary, flex: 1, fontFamily: 'monospace' }]}
            numberOfLines={1}
          >
            {fileName}
          </Text>
        </View>
        <FilePreview fileName={fileName} content={fileContent} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: c.bg, paddingTop: headerHeight }]}>
      <View style={[s.breadcrumb, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <Pressable onPress={() => fetchDir('/')} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Text style={[Typography.footnote, { color: c.textSecondary, fontWeight: '500' }]}>~</Text>
        </Pressable>
        {pathParts.map((part, i) => {
          const path = '/' + pathParts.slice(0, i + 1).join('/');
          const isLast = i === pathParts.length - 1;
          return (
            <View key={path} style={s.bcSegment}>
              <Text style={[Typography.footnote, { color: c.separator, marginHorizontal: Spacing.xs }]}>/</Text>
              <Pressable onPress={() => fetchDir(path)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <Text
                  style={[
                    Typography.footnote,
                    { color: isLast ? Colors.primary[500] : c.textSecondary, fontWeight: isLast ? '500' : '400' },
                  ]}
                >
                  {part}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {activeAgents.length > 0 && (
        <View style={[s.shortcuts, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
          <View style={s.shortcutChips}>
            {activeAgents.map((a) => {
              const active = currentPath === a.projectPath;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => fetchDir(a.projectPath)}
                  style={[
                    s.chip,
                    {
                      backgroundColor: active ? c.accentBg : c.elevated,
                      borderColor: active ? c.accentBorder : c.cardBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      Typography.caption1,
                      {
                        color: active ? Colors.primary[500] : c.textSecondary,
                        fontWeight: active ? '600' : '500',
                      },
                    ]}
                  >
                    {a.projectPath.split('/').pop()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {loading ? (
        <View style={s.loading}>
          <Spinner size="lg" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.path}
          contentContainerStyle={[s.list, (!items || items.length === 0) && s.listEmpty, { paddingTop: headerHeight + Spacing.xs }]}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={[Typography.subhead, { color: c.textSecondary }]}>No files</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => (item.isDir ? fetchDir(item.path) : openFile(item.path))}
              style={({ pressed }) => [
                s.row,
                {
                  borderBottomColor: c.separator,
                  backgroundColor: pressed
                    ? c.isDark
                      ? 'rgba(255,255,255,0.04)'
                      : 'rgba(0,0,0,0.04)'
                    : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  s.iconBox,
                  { backgroundColor: item.isDir ? c.accentBg : c.elevated },
                ]}
              >
                <Text
                  style={[
                    Typography.caption1,
                    {
                      color: item.isDir ? Colors.primary[500] : c.textTertiary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {item.isDir ? 'folder' : 'doc'}
                </Text>
              </View>
              <Text
                style={[
                  Typography.subhead,
                  {
                    color: item.isDir ? c.textPrimary : c.textSecondary,
                    fontWeight: item.isDir ? '600' : '400',
                    flex: 1,
                  },
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {!item.isDir && (
                <Text style={[Typography.caption2, { color: c.textTertiary }]}>{fmt(item.size)}</Text>
              )}
              {item.isDir && (
                <Text style={[Typography.subhead, { color: c.textTertiary, fontWeight: '300' }]}>
                  {'\u203A'}
                </Text>
              )}
            </Pressable>
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
  container: { flex: 1 },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  breadcrumb: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  bcSegment: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shortcuts: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  shortcutChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing['3xl'],
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing['4xl'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
