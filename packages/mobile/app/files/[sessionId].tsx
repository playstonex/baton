import { View, Text, FlatList, Pressable, Image, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@react-native-vector-icons/ionicons';
import { BlurView } from 'expo-blur';
import { useAgentStore } from '../../src/stores/agents';
import { apiFetch, getDaemonUrl } from '../../src/services/api';
import { FilePreview } from '../../src/components/FilePreview';
import { FileIconTile } from '../../src/components/FileIconTile';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { FontFamily, Colors, Typography, Spacing, CornerRadius, Glass } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GlassCard,
  GlassButton,
} from '../../src/components/GlassKit';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

function fmt(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export default function FilesScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const agents = useAgentStore((s) => s.agents);
  const agent = agents.find((a) => a.id === sessionId);
  const projectPath = agent?.projectPath ?? '';
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (projectPath && currentPath === '/') fetchDir(projectPath);
  }, [projectPath, currentPath]);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ path: string; items: FileEntry[] }>(`/api/files?path=${encodeURIComponent(path)}`);
      setItems(data.items ?? []);
      setCurrentPath(path);
      setFileContent(null);
      setImagePath(null);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  async function openFile(path: string, name: string) {
    if (isImageFile(name)) {
      setFileName(name);
      setImagePath(path);
      setFileContent(null);
      return;
    }
    try {
      const data = await apiFetch<{ content: string; name: string }>(`/api/files/content?path=${encodeURIComponent(path)}`);
      setFileContent(data.content);
      setFileName(data.name);
      setImagePath(null);
    } catch {
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean);

  if (imagePath !== null) {
    const uri = `${getDaemonUrl()}/api/files/raw?path=${encodeURIComponent(imagePath)}`;
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: Math.max(headerHeight, insets.top + 48), paddingBottom: insets.bottom }}>
        <BlurView
          tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          intensity={80}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: Spacing.lg,
            paddingVertical: Spacing.md,
            gap: Spacing.md,
          }}
        >
          <Text
            style={[Typography.headline, { color: c.textPrimary, flex: 1, fontFamily: FontFamily.mono }]}
            numberOfLines={1}
          >
            {fileName}
          </Text>
          <Pressable onPress={() => setImagePath(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.elevated }}
          >
            <Ionicons name="close" size={16} color={c.textSecondary} />
          </Pressable>
        </BlurView>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.md }}>
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%', borderRadius: CornerRadius.medium }}
            resizeMode="contain"
            accessibilityLabel={fileName}
          />
        </View>
      </View>
    );
  }

  if (fileContent !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: Math.max(headerHeight, insets.top + 48), paddingBottom: insets.bottom }}>
        <BlurView
          tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          intensity={80}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: Spacing.lg,
            paddingVertical: Spacing.md,
            gap: Spacing.md,
          }}
        >
          <Text
            style={[Typography.headline, { color: c.textPrimary, flex: 1, fontFamily: FontFamily.mono }]}
            numberOfLines={1}
          >
            {fileName}
          </Text>
          <Pressable onPress={() => setFileContent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.elevated }}
          >
            <Ionicons name="close" size={16} color={c.textSecondary} />
          </Pressable>
        </BlurView>
        <FilePreview fileName={fileName} content={fileContent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: Math.max(headerHeight, insets.top + 48), paddingBottom: insets.bottom }}>
      {/* Glass breadcrumb */}
      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={80}
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.sm + 2,
          alignItems: 'center',
          gap: Spacing.xs,
        }}
      >
        <Pressable onPress={() => fetchDir(projectPath)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <Ionicons name="home-outline" size={14} color={c.textSecondary} />
        </Pressable>
        {pathParts.map((part, i) => {
          const path = '/' + pathParts.slice(0, i + 1).join('/');
          const isLast = i === pathParts.length - 1;
          return (
            <View key={path} style={{ flexDirection: 'row', alignItems: 'center' }}>
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
      </BlurView>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary[500]} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.path}
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom, flexGrow: items.length === 0 ? 1 : undefined }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: Spacing['4xl'], gap: Spacing.sm }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.isDark
                    ? Glass.opacity.dark.subtle
                    : Glass.opacity.light.subtle,
                  marginBottom: Spacing.xs,
                }}
              >
                <Ionicons name="folder-open-outline" size={24} color={c.textTertiary} />
              </View>
              <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                No files here
              </Text>
              <Text style={[Typography.footnote, { color: c.textTertiary }]}>
                This directory is empty
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            return (
              <Pressable
                onPress={() => (item.isDir ? fetchDir(item.path) : openFile(item.path, item.name))}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Spacing.md,
                  paddingVertical: Spacing.sm + 2,
                  borderBottomWidth: 0.5,
                  borderBottomColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                  minHeight: 44,
                  backgroundColor: pressed
                    ? c.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
                    : 'transparent',
                })}
              >
                <FileIconTile isDir={item.isDir} name={item.name} />
                <Text
                  style={{
                    ...Typography.subhead,
                    color: item.isDir ? c.textPrimary : c.textSecondary,
                    fontWeight: item.isDir ? '600' : '400',
                    flex: 1,
                  }}
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
            );
          }}
        />
      )}
    </View>
  );
}
