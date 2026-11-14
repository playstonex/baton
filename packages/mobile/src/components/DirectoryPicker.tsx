import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { apiFetch } from '../services/api';
import { useThemeColors } from '../hooks/useThemeColors';
import { FileIconTile } from './FileIconTile';
import { Typography, CornerRadius } from '../constants/theme';

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface DirResponse {
  path: string;
  items: (DirEntry & { size: number; modified: string })[];
}

interface DirectoryPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryPicker({ visible, onClose, onSelect, initialPath }: DirectoryPickerProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const startPath = initialPath && initialPath.trim() ? initialPath : '/';
  const [currentPath, setCurrentPath] = useState(startPath);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<DirResponse>(`/api/files?path=${encodeURIComponent(path)}`);
      const folders = data.items.filter((item) => item.isDir);
      setDirs(folders);
      setCurrentPath(data.path);
    } catch (err) {
      setError(String(err));
      setDirs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload only when the picker opens — an initialPath change while it is
  // already open must not reset where the user has browsed to.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      loadDir(startPath);
    }
    wasVisible.current = visible;
  }, [visible, startPath, loadDir]);

  function goUp() {
    const parts = currentPath.replace(/\/$/, '').split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    loadDir(parent);
  }

  function renderItem({ item }: ListRenderItemInfo<DirEntry>) {
    return (
      <Pressable
        onPress={() => loadDir(item.path)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? c.subtle : c.card, borderBottomColor: c.cardBorder },
        ]}
      >
        <FileIconTile isDir name={item.name} size="sm" />
        <Text style={[styles.rowName, { color: c.textPrimary }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.chevron, { color: c.textTertiary }]}>›</Text>
      </Pressable>
    );
  }

  if (!visible) return null;

  const safeTop = Math.max(insets.top, Platform.OS === 'ios' ? 44 : 20);
  const folderName = currentPath.split('/').filter(Boolean).pop() || '/';

  return (
    <View
      style={[
        styles.modal,
        {
          backgroundColor: c.bg,
          paddingTop: safeTop,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Header Container */}
      <View style={[styles.headerContainer, { borderBottomColor: c.cardBorder }]}>
        {/* Top actions bar: Cancel | Folder Name | Select button */}
        <View style={styles.headerBar}>
          <Pressable onPress={onClose} style={styles.headerBtn} hitSlop={8}>
            <Text style={[styles.headerBtnText, { color: c.textSecondary }]}>Cancel</Text>
          </Pressable>

          <Text style={[styles.folderName, { color: c.textPrimary }]} numberOfLines={1}>
            {folderName}
          </Text>

          <Pressable
            onPress={() => onSelect(currentPath)}
            style={({ pressed }) => [
              styles.selectPill,
              { backgroundColor: c.accentBg, opacity: pressed ? 0.75 : 1 },
            ]}
            hitSlop={8}
          >
            <Text style={styles.selectPillText}>Select</Text>
          </Pressable>
        </View>

        {/* Path Breadcrumb */}
        <View
          style={[
            styles.breadcrumbRow,
            { backgroundColor: c.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
          ]}
        >
          <Ionicons name="folder-open-outline" size={13} color={c.textTertiary} />
          <Text
            style={[styles.breadcrumbText, { color: c.textTertiary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {currentPath}
          </Text>
        </View>
      </View>

      {/* Navigation up one directory */}
      <Pressable
        onPress={goUp}
        style={[styles.row, { backgroundColor: c.card, borderBottomColor: c.cardBorder }]}
      >
        <View
          style={[
            styles.upTile,
            { backgroundColor: c.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' },
          ]}
        >
          <Ionicons name="arrow-up" size={14} color={c.textSecondary} />
        </View>
        <Text style={[styles.rowName, { color: c.textSecondary }]}>..</Text>
      </Pressable>

      {/* Directory list or loading/error */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={c.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: '#dc2626' }]}>{error}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={() => loadDir(currentPath)} style={styles.retryBtn}>
              <Text style={[styles.retryText, { color: '#2383e2' }]}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => loadDir('/')} style={styles.retryBtn}>
              <Text style={[styles.retryText, { color: '#2383e2' }]}>Go to /</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={dirs}
          keyExtractor={(item) => item.path}
          renderItem={renderItem}
          contentContainerStyle={dirs.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: c.textTertiary }]}>No folders</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    elevation: 8,
    zIndex: 999,
  },
  headerContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 38,
  },
  headerBtn: {
    paddingVertical: 4,
    minWidth: 60,
  },
  headerBtnText: {
    ...Typography.body,
    fontSize: 16,
    fontWeight: '500',
  },
  folderName: {
    ...Typography.headline,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
    marginHorizontal: 8,
  },
  selectPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectPillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: CornerRadius.small,
  },
  breadcrumbText: {
    ...Typography.caption2,
    fontSize: 12,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  upTile: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowName: { flex: 1, fontSize: 15 },
  chevron: { fontSize: 18 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryBtn: { padding: 8 },
  retryText: { fontSize: 14, fontWeight: '500' },
  emptyList: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },
});
