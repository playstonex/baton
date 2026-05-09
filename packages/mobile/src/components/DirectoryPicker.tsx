import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spinner } from 'heroui-native';
import { apiFetch } from '../services/api';
import { useThemeColors } from '../hooks/useThemeColors';

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
  const [currentPath, setCurrentPath] = useState(initialPath ?? '/');
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

  useEffect(() => {
    if (visible) {
      loadDir(initialPath ?? '/');
    }
  }, [visible, initialPath, loadDir]);

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
        <Text style={[styles.rowIcon, { color: c.textTertiary }]}>📁</Text>
        <Text style={[styles.rowName, { color: c.textPrimary }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.chevron, { color: c.textTertiary }]}>›</Text>
      </Pressable>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={[styles.modal, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: c.cardBorder }]}>
          <Pressable onPress={onClose} style={styles.headerBtn}>
            <Text style={[styles.headerBtnText, { color: c.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {currentPath}
          </Text>
          <Pressable onPress={() => onSelect(currentPath)} style={styles.headerBtn}>
            <Text style={[styles.headerBtnText, { color: '#2383e2' }]}>Select</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={goUp}
          style={[styles.row, { backgroundColor: c.card, borderBottomColor: c.cardBorder }]}
        >
          <Text style={[styles.rowIcon, { color: c.textTertiary }]}>⬆️</Text>
          <Text style={[styles.rowName, { color: c.textSecondary }]}>..</Text>
        </Pressable>

        {loading ? (
          <View style={styles.center}>
            <Spinner size="sm" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: '#dc2626' }]}>{error}</Text>
            <Pressable onPress={() => loadDir(currentPath)} style={styles.retryBtn}>
              <Text style={[styles.retryText, { color: '#2383e2' }]}>Retry</Text>
            </Pressable>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerBtn: { paddingVertical: 4 },
  headerBtnText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: '500', textAlign: 'center', marginHorizontal: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { fontSize: 18, marginRight: 10 },
  rowName: { flex: 1, fontSize: 15 },
  chevron: { fontSize: 20, fontWeight: '300' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errorText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { fontSize: 14, fontWeight: '500' },
  emptyList: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 14 },
});
