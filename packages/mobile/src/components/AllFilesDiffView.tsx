import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { BlurView } from 'expo-blur';
import type {
  GitStatusResult,
  GitDiffResult,
  GitFileDiff,
  GitDiffLine,
} from '@baton/shared';
import { gitService } from '../services/git';
import { useThemeColors } from '../hooks/useThemeColors';
import { FontFamily, Typography, Spacing, CornerRadius, Colors } from '../constants/theme';

export interface AllFilesDiffViewProps {
  visible: boolean;
  sessionId: string;
  projectPath: string;
  onClose: () => void;
  onCommitSuccess?: () => void;
}

export const AllFilesDiffView: React.FC<AllFilesDiffViewProps> = ({
  visible,
  projectPath,
  onClose,
  onCommitSuccess,
}) => {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectPath || !visible) return;
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        gitService.status(projectPath).catch(() => null),
        gitService.diff(projectPath).catch(() => ({ files: [] })),
      ]);
      setStatus(s);
      setDiff(d);
      // Auto-expand all files if 3 or fewer, otherwise leave collapsed
      if (d?.files && d.files.length <= 3) {
        setExpandedFiles(new Set(d.files.map((f) => f.path)));
      } else {
        setExpandedFiles(new Set());
      }
    } catch {
      setStatus(null);
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath, visible]);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible, loadData]);

  // Aggregate stats
  const totalAdd = useMemo(() => diff?.files.reduce((s, f) => s + f.additions, 0) ?? 0, [diff]);
  const totalDel = useMemo(() => diff?.files.reduce((s, f) => s + f.deletions, 0) ?? 0, [diff]);
  const totalFiles = diff?.files.length ?? 0;

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (!diff?.files) return [];
    if (!searchFilter.trim()) return diff.files;
    const q = searchFilter.toLowerCase();
    return diff.files.filter((f) => f.path.toLowerCase().includes(q));
  }, [diff, searchFilter]);

  const toggleExpandFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!diff?.files) return;
    if (expandedFiles.size === diff.files.length) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(diff.files.map((f) => f.path)));
    }
  };

  const handleCommit = async () => {
    if (!projectPath || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      await gitService.commit({
        projectPath,
        message: commitMsg.trim(),
        all: true,
      });
      setShowCommitModal(false);
      setCommitMsg('');
      onCommitSuccess?.();
      await loadData();
      Alert.alert('Committed', 'Changes successfully committed.');
    } catch (err) {
      Alert.alert('Commit Failed', String(err));
    } finally {
      setCommitting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        {/* Top Header */}
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top > 0 ? insets.top + Spacing.xs : Spacing.md,
              borderBottomColor: c.separator,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={c.textPrimary} />
          </Pressable>

          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
              Review Changes
            </Text>
            {status?.branch && (
              <View style={styles.branchRow}>
                <Ionicons name="git-branch" size={12} color={Colors.primary[500]} />
                <Text style={[styles.branchText, { color: Colors.primary[500] }]} numberOfLines={1}>
                  {status.branch}
                </Text>
              </View>
            )}
          </View>

          {/* Quick Commit button */}
          {totalFiles > 0 && (
            <Pressable
              onPress={() => setShowCommitModal(true)}
              style={({ pressed }) => [
                styles.commitBtn,
                {
                  backgroundColor: pressed ? Colors.primary[600] : Colors.primary[500],
                },
              ]}
            >
              <Ionicons name="checkmark-circle-outline" size={15} color="#fff" />
              <Text style={styles.commitBtnText}>Commit</Text>
            </Pressable>
          )}
        </View>

        {/* Aggregate Stats & Control Bar */}
        <View
          style={[
            styles.statsBar,
            {
              backgroundColor: c.isDark ? 'rgba(58,58,60,0.35)' : c.elevated,
              borderBottomColor: c.separator,
            },
          ]}
        >
          <View style={styles.statsLeft}>
            <Text style={[styles.statsFiles, { color: c.textSecondary }]}>
              {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
            </Text>
            {totalAdd + totalDel > 0 && (
              <View style={styles.diffCounts}>
                {totalAdd > 0 && (
                  <Text style={[styles.statAdd, { color: Colors.success[400] }]}>+{totalAdd}</Text>
                )}
                {totalDel > 0 && (
                  <Text style={[styles.statDel, { color: Colors.danger[400] }]}>−{totalDel}</Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.statsRight}>
            <Pressable onPress={loadData} hitSlop={6} style={styles.iconAction}>
              <Ionicons name="refresh-outline" size={17} color={c.textSecondary} />
            </Pressable>
            {totalFiles > 0 && (
              <Pressable onPress={toggleAll} style={styles.toggleAllBtn} hitSlop={6}>
                <Ionicons
                  name={expandedFiles.size === totalFiles ? 'chevron-collapse-outline' : 'chevron-expand-outline'}
                  size={15}
                  color={c.textSecondary}
                />
                <Text style={[styles.toggleAllText, { color: c.textSecondary }]}>
                  {expandedFiles.size === totalFiles ? 'Collapse All' : 'Expand All'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Filter input */}
        {totalFiles > 1 && (
          <View style={[styles.filterRow, { borderBottomColor: c.separator }]}>
            <Ionicons name="search-outline" size={15} color={c.textTertiary} />
            <TextInput
              style={[styles.filterInput, { color: c.textPrimary }]}
              value={searchFilter}
              onChangeText={setSearchFilter}
              placeholder="Filter changed files..."
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {searchFilter.length > 0 && (
              <Pressable onPress={() => setSearchFilter('')} hitSlop={6}>
                <Ionicons name="close-circle" size={16} color={c.textTertiary} />
              </Pressable>
            )}
          </View>
        )}

        {/* Main Content Area */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={Colors.primary[500]} size="large" />
            <Text style={[styles.loadingText, { color: c.textTertiary }]}>Computing diffs...</Text>
          </View>
        ) : totalFiles === 0 ? (
          <View style={styles.centerContainer}>
            <View style={[styles.cleanIconWrap, { backgroundColor: Colors.success[400] + '18' }]}>
              <Ionicons name="checkmark-done-circle" size={48} color={Colors.success[400]} />
            </View>
            <Text style={[styles.cleanTitle, { color: c.textPrimary }]}>
              Working Tree Clean
            </Text>
            <Text style={[styles.cleanSub, { color: c.textTertiary }]}>
              No modified, staged, or untracked changes in this workspace.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.filesScroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          >
            {filteredFiles.map((file) => {
              const isExpanded = expandedFiles.has(file.path);
              return (
                <FileAccordionItem
                  key={file.path}
                  file={file}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpandFile(file.path)}
                  colors={c}
                />
              );
            })}
          </ScrollView>
        )}

        {/* Quick Commit Modal */}
        <Modal
          visible={showCommitModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCommitModal(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCommitModal(false)}>
            <Pressable
              style={[
                styles.commitSheet,
                {
                  backgroundColor: c.isDark ? '#242426' : '#fff',
                  borderColor: c.separator,
                },
              ]}
              onPress={() => {}}
            >
              <Text style={[styles.commitSheetTitle, { color: c.textPrimary }]}>
                Commit Changes
              </Text>
              <Text style={[styles.commitSheetSub, { color: c.textTertiary }]}>
                Committing all {totalFiles} changed files on branch {status?.branch ?? 'HEAD'}.
              </Text>

              <TextInput
                autoFocus
                style={[
                  styles.commitInput,
                  {
                    color: c.textPrimary,
                    borderColor: c.separator,
                    backgroundColor: c.isDark ? '#1c1c1e' : '#f5f5f7',
                  },
                ]}
                placeholder="Commit message (e.g. feat: implement autocomplete)"
                placeholderTextColor={c.textTertiary}
                value={commitMsg}
                onChangeText={setCommitMsg}
                multiline
                numberOfLines={3}
              />

              <View style={styles.commitActions}>
                <Pressable
                  onPress={() => setShowCommitModal(false)}
                  style={[styles.sheetCancelBtn, { borderColor: c.separator }]}
                >
                  <Text style={[styles.sheetCancelText, { color: c.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleCommit}
                  disabled={committing || !commitMsg.trim()}
                  style={[
                    styles.sheetConfirmBtn,
                    {
                      backgroundColor:
                        committing || !commitMsg.trim() ? c.subtle : Colors.primary[500],
                    },
                  ]}
                >
                  {committing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.sheetConfirmText}>Commit & Sync</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
};

function FileAccordionItem({
  file,
  isExpanded,
  onToggle,
  colors: c,
}: {
  file: GitFileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  colors: any;
}) {
  const parts = file.path.split('/');
  const filename = parts.pop() ?? file.path;
  const dir = parts.join('/');

  const statusColor =
    file.status === 'added'
      ? Colors.success[400]
      : file.status === 'deleted'
        ? Colors.danger[400]
        : Colors.primary[500];

  const statusLetter =
    file.status === 'added'
      ? 'A'
      : file.status === 'deleted'
        ? 'D'
        : file.status === 'renamed'
          ? 'R'
          : 'M';

  return (
    <View style={[styles.fileCard, { borderBottomColor: c.separator }]}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.fileHeader,
          {
            backgroundColor: pressed
              ? c.isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)'
              : c.isDark
                ? 'rgba(44,44,46,0.6)'
                : c.card,
          },
        ]}
      >
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLetter}</Text>
        </View>

        <View style={styles.fileNameCol}>
          <Text style={[styles.fileName, { color: c.textPrimary }]} numberOfLines={1}>
            {filename}
          </Text>
          {dir.length > 0 && (
            <Text style={[styles.fileDir, { color: c.textTertiary }]} numberOfLines={1}>
              {dir}/
            </Text>
          )}
        </View>

        {file.additions > 0 && (
          <Text style={[styles.hunkAdd, { color: Colors.success[400] }]}>+{file.additions}</Text>
        )}
        {file.deletions > 0 && (
          <Text style={[styles.hunkDel, { color: Colors.danger[400] }]}>−{file.deletions}</Text>
        )}

        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={c.textTertiary}
          style={{ marginLeft: 4 }}
        />
      </Pressable>

      {isExpanded && (
        <View style={[styles.fileDiffBody, { backgroundColor: c.isDark ? '#151516' : '#fafafa' }]}>
          {file.hunks.length === 0 ? (
            <Text style={[styles.emptyHunk, { color: c.textTertiary }]}>No diff contents available</Text>
          ) : (
            file.hunks.map((hunk, hi) => (
              <View key={hi} style={styles.hunkGroup}>
                <View
                  style={[
                    styles.hunkHeaderRow,
                    {
                      backgroundColor: c.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    },
                  ]}
                >
                  <Text style={[styles.hunkHeaderText, { color: c.textTertiary }]}>
                    {hunk.header}
                  </Text>
                </View>
                {hunk.lines.map((line, li) => (
                  <DiffRow key={li} line={line} colors={c} />
                ))}
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function DiffRow({ line, colors: c }: { line: GitDiffLine; colors: any }) {
  const isAdd = line.type === 'add';
  const isDel = line.type === 'remove';

  const bg = isAdd
    ? 'rgba(34,197,94,0.12)'
    : isDel
      ? 'rgba(239,68,68,0.12)'
      : 'transparent';

  const textColor = isAdd
    ? Colors.success[400]
    : isDel
      ? Colors.danger[400]
      : c.textSecondary;

  const prefix = isAdd ? '+' : isDel ? '−' : ' ';

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1 }}>
      <View style={[styles.diffRow, { backgroundColor: bg }]}>
        <View style={styles.lineNums}>
          <Text style={[styles.lineNumText, { color: c.textTertiary }]}>
            {line.oldLine ?? ' '}
          </Text>
          <Text style={[styles.lineNumText, { color: c.textTertiary }]}>
            {line.newLine ?? ' '}
          </Text>
        </View>

        <Text style={[styles.diffPrefix, { color: textColor }]}>{prefix}</Text>
        <Text style={[styles.diffContent, { color: textColor }]} numberOfLines={1}>
          {line.content}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  branchText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FontFamily.mono,
  },
  commitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: CornerRadius.medium,
  },
  commitBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statsFiles: {
    fontSize: 13,
    fontWeight: '600',
  },
  diffCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statAdd: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
  },
  statDel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
  },
  statsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconAction: {
    padding: 4,
  },
  toggleAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  toggleAllText: {
    fontSize: 12,
    fontWeight: '500',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  filterInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 10,
  },
  cleanIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cleanTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  cleanSub: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  filesScroll: {
    flex: 1,
  },
  fileCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    gap: Spacing.sm,
  },
  statusBadge: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  fileNameCol: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileDir: {
    fontSize: 11,
    fontFamily: FontFamily.mono,
    marginTop: 1,
  },
  hunkAdd: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
  },
  hunkDel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
  },
  fileDiffBody: {
    paddingVertical: 4,
  },
  emptyHunk: {
    fontSize: 12,
    padding: Spacing.md,
    fontStyle: 'italic',
  },
  hunkGroup: {
    marginBottom: 6,
  },
  hunkHeaderRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
  },
  hunkHeaderText: {
    fontSize: 10,
    fontFamily: FontFamily.mono,
  },
  diffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 2,
    minWidth: '100%',
  },
  lineNums: {
    flexDirection: 'row',
    width: 44,
    gap: 6,
    marginRight: 6,
  },
  lineNumText: {
    width: 18,
    fontSize: 10,
    fontFamily: FontFamily.mono,
    textAlign: 'right',
  },
  diffPrefix: {
    width: 14,
    fontSize: 11,
    fontFamily: FontFamily.mono,
    fontWeight: '700',
  },
  diffContent: {
    fontSize: 12,
    fontFamily: FontFamily.mono,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  commitSheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: CornerRadius.large,
    borderWidth: 1,
    padding: Spacing.lg,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  commitSheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  commitSheetSub: {
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 16,
  },
  commitInput: {
    borderWidth: 1,
    borderRadius: CornerRadius.medium,
    padding: Spacing.sm,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: Spacing.md,
  },
  commitActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'flex-end',
  },
  sheetCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: CornerRadius.medium,
    borderWidth: 1,
  },
  sheetCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sheetConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: CornerRadius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  sheetConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
