import {
  ActionSheetIOS,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
  Text,
  TextInput,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitBranchesResult,
  GitStatusFile,
  GitDiffResult,
  GitFileDiff,
  GitDiffLine,
} from '@baton/shared';
import { gitService } from '../../src/services/git';
import { useConnectionStore } from '../../src/stores/connection';
import { useAgentStore } from '../../src/stores/agents';
import {
  Typography,
  Spacing,
  CornerRadius,
  iOSGroupedRadius,
  Colors,
} from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

type Tab = 'changes' | 'history' | 'branches';

const LANE_WIDTH = 20;
const ROW_HEIGHT = 56;
const LANE_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];

interface GraphRow {
  commit: GitLogEntry;
  lane: number;
  maxLane: number;
  verticalLines: { lane: number; color: string; isMine: boolean }[];
  forks: { fromLane: number; toLane: number; color: string }[];
  isLast: boolean;
}

export default function GitScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const c = useThemeColors();
  const connected = useConnectionStore((s) => s.connected);
  const agents = useAgentStore((s) => s.agents);
  const agent = agents.find((a) => a.id === sessionId);
  const projectPath = agent?.projectPath ?? '';
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<GitBranchesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [tab, setTab] = useState<Tab>('changes');
  const [busy, setBusy] = useState<string | null>(null);

  const [diffModal, setDiffModal] = useState<{
    title: string;
    subtitle?: string;
    loading: boolean;
    diff: GitDiffResult | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath || !connected) return;
    setLoading(true);
    try {
      const [s, l, b] = await Promise.all([
        gitService.status(projectPath).catch(() => null),
        gitService.log(projectPath, 50).catch(() => null),
        gitService.branches(projectPath).catch(() => null),
      ]);
      if (s) setStatus(s);
      if (l) setLog(l.entries);
      if (b) setBranches(b);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [projectPath, connected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const graphRows = useMemo(() => buildGraph(log), [log]);
  const maxLane = useMemo(() => {
    let m = 0;
    for (const r of graphRows) if (r.maxLane > m) m = r.maxLane;
    return m;
  }, [graphRows]);

  function runWith(name: string, fn: () => Promise<void>) {
    return async () => {
      if (busy) return;
      setBusy(name);
      try {
        await fn();
      } catch (err) {
        Alert.alert(name + ' Failed', String(err));
      } finally {
        setBusy(null);
      }
    };
  }

  async function handleCommit() {
    if (!projectPath) return;
    await gitService.commit({ projectPath, message: commitMsg || undefined, all: true });
    setCommitMsg('');
    await refresh();
  }

  async function handlePush() {
    if (!projectPath) return;
    const result = await gitService.push(projectPath);
    if (!result.success) Alert.alert('Push Failed', result.output);
    await refresh();
  }

  async function handlePull() {
    if (!projectPath) return;
    const result = await gitService.pull(projectPath);
    if (result.conflict) Alert.alert('Conflict', 'Merge conflict detected');
    await refresh();
  }

  async function handleStash() {
    if (!projectPath) return;
    await gitService.stash(projectPath);
    await refresh();
  }

  async function handleStashPop() {
    if (!projectPath) return;
    await gitService.stashPop(projectPath);
    await refresh();
  }

  function handleCheckout(branch: string) {
    if (!projectPath || branch === status?.branch) return;
    runWith('Checkout', async () => {
      await gitService.checkout({ projectPath, branch });
      await refresh();
    })();
  }

  function showBranchSheet() {
    if (!branches) return;
    const options = branches.branches.map((b) =>
      b.current ? `${b.name} (current)` : b.name + (b.default ? ' (default)' : ''),
    );
    options.push('Cancel');
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, title: 'Switch Branch' },
      (idx) => {
        if (idx === undefined || idx === options.length - 1) return;
        const branch = branches.branches[idx];
        if (branch && !branch.current) handleCheckout(branch.name);
      },
    );
  }

  function showMoreActions() {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Stash', 'Pop Stash', 'New Branch…', 'Cancel'], cancelButtonIndex: 3 },
      (idx) => {
        if (idx === 0) runWith('Stash', handleStash)();
        else if (idx === 1) runWith('Pop', handleStashPop)();
        else if (idx === 2) promptNewBranch();
      },
    );
  }

  function promptNewBranch() {
    if (!projectPath) return;
    Alert.prompt('New Branch', 'Enter branch name', async (name) => {
      if (!name) return;
      try {
        await gitService.createBranch({ projectPath, branch: name, checkout: true });
        await refresh();
      } catch (err) {
        Alert.alert('Failed', String(err));
      }
    });
  }

  async function openFileDiff(file: GitStatusFile) {
    setDiffModal({ title: file.path, subtitle: file.status, loading: true, diff: null });
    try {
      const result = await gitService.diff(projectPath, file.path);
      setDiffModal({ title: file.path, subtitle: file.status, loading: false, diff: result });
    } catch (err) {
      setDiffModal({
        title: file.path,
        subtitle: file.status,
        loading: false,
        diff: { files: [] },
      });
    }
  }

  async function openCommitDiff(entry: GitLogEntry) {
    setDiffModal({
      title: entry.message,
      subtitle: `${entry.shortHash} · ${entry.author}`,
      loading: true,
      diff: null,
    });
    try {
      const result = await gitService.commitDiff(projectPath, entry.hash);
      setDiffModal({
        title: entry.message,
        subtitle: `${entry.shortHash} · ${entry.author}`,
        loading: false,
        diff: result,
      });
    } catch {
      setDiffModal({
        title: entry.message,
        subtitle: `${entry.shortHash} · ${entry.author}`,
        loading: false,
        diff: { files: [] },
      });
    }
  }

  const dirtyCount = status?.files.length ?? 0;
  const branchCount = branches?.branches.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={{
          paddingTop: headerHeight,
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.sm,
          backgroundColor: c.bg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Pressable
            onPress={showBranchSheet}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: Spacing.md,
              paddingVertical: 6,
              borderRadius: CornerRadius.medium,
              backgroundColor: pressed ? c.subtle : c.accentBg,
              minWidth: 0,
            })}
          >
            <Ionicons name="git-branch" size={16} color={Colors.primary[500]} />
            <Text
              style={[Typography.subhead, { color: Colors.primary[500], fontWeight: '600' }]}
              numberOfLines={1}
            >
              {status?.branch ?? '—'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.primary[500]} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {status && status.ahead > 0 && (
            <Badge icon="arrow-up" text={String(status.ahead)} color={Colors.success[400]} />
          )}
          {status && status.behind > 0 && (
            <Badge icon="arrow-down" text={String(status.behind)} color={Colors.danger[400]} />
          )}
          {status && !status.dirty && status.ahead === 0 && status.behind === 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: CornerRadius.small,
                backgroundColor: Colors.success[400] + '18',
              }}
            >
              <Ionicons name="checkmark-circle" size={13} color={Colors.success[400]} />
              <Text style={[Typography.caption2, { color: Colors.success[400], fontWeight: '600' }]}>
                Clean
              </Text>
            </View>
          )}
          <Pressable onPress={refresh} hitSlop={8} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color={c.textSecondary} />
            ) : (
              <Ionicons name="refresh-outline" size={20} color={c.textSecondary} />
            )}
          </Pressable>
        </View>
        {status?.tracking && (
          <Text
            style={[Typography.caption2, { color: c.textTertiary, marginTop: 4, marginLeft: 2 }]}
            numberOfLines={1}
          >
            {status.tracking}
          </Text>
        )}
      </View>

      <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm }}>
        <SegmentedControl
          tabs={[
            { key: 'changes', label: 'Changes', badge: dirtyCount },
            { key: 'history', label: 'History' },
            { key: 'branches', label: 'Branches', badge: branchCount },
          ]}
          active={tab}
          onChange={setTab}
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + 80,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!projectPath && <EmptyCard text="Agent not found or no project path" />}
        {projectPath && loading && !status && <LoadingBlock />}
        {projectPath && tab === 'changes' && (
          <ChangesTab
            status={status}
            commitMsg={commitMsg}
            setCommitMsg={setCommitMsg}
            onCommit={runWith('Commit', handleCommit)}
            busy={busy === 'Commit'}
            disabled={!connected}
            onFilePress={openFileDiff}
          />
        )}
        {projectPath && tab === 'history' && (
          <HistoryTab
            graphRows={graphRows}
            maxLane={maxLane}
            currentBranch={status?.branch}
            onCommitPress={openCommitDiff}
          />
        )}
        {projectPath && tab === 'branches' && (
          <BranchesTab
            branches={branches}
            currentBranch={status?.branch}
            onCheckout={handleCheckout}
          />
        )}
      </ScrollView>

      {projectPath && status && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            flexDirection: 'row',
            paddingHorizontal: Spacing.lg,
            paddingTop: Spacing.sm,
            paddingBottom: insets.bottom + Spacing.sm,
            backgroundColor: c.card,
            borderTopWidth: 1,
            borderTopColor: c.separator,
            gap: Spacing.sm,
          }}
        >
          <ToolbarBtn
            icon="arrow-up"
            label="Push"
            color={Colors.primary[500]}
            onPress={runWith('Push', handlePush)}
            disabled={!connected || busy !== null}
            busy={busy === 'Push'}
          />
          <ToolbarBtn
            icon="arrow-down"
            label="Pull"
            color={Colors.success[400]}
            onPress={runWith('Pull', handlePull)}
            disabled={!connected || busy !== null}
            busy={busy === 'Pull'}
          />
          <ToolbarBtn
            icon="ellipsis-horizontal"
            label="More"
            color={c.textSecondary}
            onPress={showMoreActions}
            disabled={busy !== null}
          />
        </View>
      )}

      <DiffModal state={diffModal} onClose={() => setDiffModal(null)} />
    </View>
  );
}

/* ── Graph Algorithm ──────────────────────────────────────────────────────── */

function buildGraph(commits: GitLogEntry[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const lanes: (string | null)[] = [];

  for (let ci = 0; ci < commits.length; ci++) {
    const commit = commits[ci];

    let myLane = lanes.indexOf(commit.hash);
    if (myLane === -1) {
      myLane = lanes.length;
      lanes.push(commit.hash);
    }

    const color = LANE_COLORS[myLane % LANE_COLORS.length];
    const forks: { fromLane: number; toLane: number; color: string }[] = [];

    const activeBefore = lanes
      .map((h, i) => ({ hash: h, lane: i }))
      .filter((x) => x.hash !== null);

    if (commit.parents.length === 0) {
      lanes[myLane] = null;
    } else {
      lanes[myLane] = commit.parents[0];
    }

    for (let pi = 1; pi < commit.parents.length; pi++) {
      const insertAt = myLane + pi;
      lanes.splice(insertAt, 0, commit.parents[pi]);
      forks.push({
        fromLane: myLane,
        toLane: insertAt,
        color: LANE_COLORS[insertAt % LANE_COLORS.length],
      });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const maxLane = Math.max(myLane, lanes.length - 1, 0);

    rows.push({
      commit,
      lane: myLane,
      maxLane,
      verticalLines: activeBefore.map((a) => ({
        lane: a.lane,
        color: LANE_COLORS[a.lane % LANE_COLORS.length],
        isMine: a.lane === myLane,
      })),
      forks,
      isLast: ci === commits.length - 1,
    });
  }

  return rows;
}

/* ── Segmented Control ────────────────────────────────────────────────────── */

function SegmentedControl({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: Tab; label: string; badge?: number }[];
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  const c = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.elevated,
        borderRadius: CornerRadius.medium,
        padding: 3,
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 7,
              borderRadius: CornerRadius.medium,
              backgroundColor: isActive ? c.card : 'transparent',
            }}
          >
            <Text
              style={[
                Typography.subhead,
                {
                  color: isActive ? c.textPrimary : c.textSecondary,
                  fontWeight: isActive ? '600' : '500',
                  fontSize: 13,
                },
              ]}
            >
              {t.label}
            </Text>
            {t.badge != null && t.badge > 0 && (
              <View
                style={{
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  paddingHorizontal: 4,
                  backgroundColor: isActive ? Colors.primary[500] : c.subtle,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: isActive ? '#fff' : c.textSecondary,
                    fontSize: 10,
                    fontWeight: '700',
                  }}
                >
                  {t.badge > 99 ? '99+' : t.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function Badge({ icon, text, color }: { icon: string; text: string; color: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: CornerRadius.small,
        backgroundColor: color + '18',
      }}
    >
      <Ionicons name={icon as any} size={11} color={color} />
      <Text style={[Typography.caption2, { color, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  const c = useThemeColors();
  return (
    <View style={{ backgroundColor: c.card, borderRadius: iOSGroupedRadius, padding: Spacing.lg }}>
      <Text style={[Typography.footnote, { color: c.textSecondary }]}>{text}</Text>
    </View>
  );
}

function LoadingBlock() {
  const c = useThemeColors();
  return (
    <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
      <ActivityIndicator color={Colors.primary[500]} />
      <Text style={[Typography.caption1, { color: c.textTertiary, marginTop: 8 }]}>
        Loading git status…
      </Text>
    </View>
  );
}

/* ── Changes Tab ──────────────────────────────────────────────────────────── */

function ChangesTab({
  status,
  commitMsg,
  setCommitMsg,
  onCommit,
  busy,
  disabled,
  onFilePress,
}: {
  status: GitStatusResult | null;
  commitMsg: string;
  setCommitMsg: (s: string) => void;
  onCommit: () => void;
  busy: boolean;
  disabled: boolean;
  onFilePress: (file: GitStatusFile) => void;
}) {
  const c = useThemeColors();

  if (!status) return <EmptyCard text="No status available" />;

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  return (
    <View style={{ gap: Spacing.md }}>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: iOSGroupedRadius,
          padding: Spacing.md,
          gap: Spacing.sm,
        }}
      >
        <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase' }]}>
          Commit
        </Text>
        <TextInput
          style={{
            backgroundColor: c.inputBg,
            borderWidth: 1,
            borderColor: c.inputBorder,
            borderRadius: CornerRadius.medium,
            paddingHorizontal: Spacing.md,
            paddingVertical: Spacing.sm,
            fontSize: Typography.body.fontSize,
            color: c.textPrimary,
            minHeight: 44,
            fontFamily: 'Menlo',
          }}
          placeholder="Commit message (optional)"
          placeholderTextColor={c.textTertiary}
          value={commitMsg}
          onChangeText={setCommitMsg}
          returnKeyType="done"
        />
        <Pressable
          onPress={onCommit}
          disabled={disabled || !status.dirty || busy}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 11,
            borderRadius: CornerRadius.medium,
            backgroundColor:
              disabled || !status.dirty || busy
                ? c.subtle
                : pressed
                  ? Colors.primary[600]
                  : Colors.primary[500],
            minHeight: 44,
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={[Typography.subhead, { color: '#fff', fontWeight: '600' }]}>
                Commit {status.files.length} file{status.files.length !== 1 ? 's' : ''}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {unstaged.length > 0 && <FileSection title="Unstaged" files={unstaged} onPress={onFilePress} />}
      {staged.length > 0 && <FileSection title="Staged" files={staged} onPress={onFilePress} />}

      {status.files.length === 0 && (
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: iOSGroupedRadius,
            padding: Spacing.xl,
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Ionicons name="checkmark-done-circle" size={36} color={Colors.success[400]} />
          <Text style={[Typography.subhead, { color: c.textSecondary }]}>
            Working tree clean
          </Text>
        </View>
      )}
    </View>
  );
}

function FileSection({
  title,
  files,
  onPress,
}: {
  title: string;
  files: GitStatusFile[];
  onPress: (file: GitStatusFile) => void;
}) {
  const c = useThemeColors();
  return (
    <View style={{ backgroundColor: c.card, borderRadius: iOSGroupedRadius, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.sm,
        }}
      >
        <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase' }]}>
          {title}
        </Text>
        <Text style={[Typography.caption2, { color: c.textTertiary }]}>{files.length}</Text>
      </View>
      {files.map((file, i) => (
        <FileRow
          key={file.path + i}
          file={file}
          last={i === files.length - 1}
          onPress={() => onPress(file)}
        />
      ))}
    </View>
  );
}

function FileRow({
  file,
  last,
  onPress,
}: {
  file: GitStatusFile;
  last: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const { icon, color, label } = fileMeta(file.status);
  const parts = file.path.split('/');
  const filename = parts.pop() ?? file.path;
  const dir = parts.join('/');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: 10,
        gap: Spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.separator,
        minHeight: 44,
        backgroundColor: pressed ? c.subtle : 'transparent',
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          backgroundColor: color + '18',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon as any} size={15} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[Typography.subhead, { color: c.textPrimary, fontWeight: '500' }]}
          numberOfLines={1}
        >
          {filename}
        </Text>
        {dir.length > 0 && (
          <Text
            style={[Typography.caption2, { color: c.textTertiary, fontFamily: 'Menlo' }]}
            numberOfLines={1}
          >
            {dir}/
          </Text>
        )}
      </View>
      <Text style={[Typography.caption2, { color, fontWeight: '700', textTransform: 'uppercase' }]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={c.textTertiary} />
    </Pressable>
  );
}

function fileMeta(status: GitStatusFile['status']): {
  icon: string;
  color: string;
  label: string;
} {
  switch (status) {
    case 'added':
      return { icon: 'add-circle', color: Colors.success[400], label: 'Add' };
    case 'deleted':
      return { icon: 'remove-circle', color: Colors.danger[400], label: 'Del' };
    case 'renamed':
      return { icon: 'arrow-forward-circle', color: Colors.primary[500], label: 'Ren' };
    case 'untracked':
      return { icon: 'help-circle', color: Colors.warning[400], label: 'New' };
    default:
      return { icon: 'create', color: Colors.primary[500], label: 'Mod' };
  }
}

/* ── History Tab (commit graph) ───────────────────────────────────────────── */

function HistoryTab({
  graphRows,
  maxLane,
  currentBranch,
  onCommitPress,
}: {
  graphRows: GraphRow[];
  maxLane: number;
  currentBranch?: string;
  onCommitPress: (entry: GitLogEntry) => void;
}) {
  const c = useThemeColors();
  const graphWidth = (maxLane + 1) * LANE_WIDTH + 6;

  if (graphRows.length === 0) return <EmptyCard text="No commits yet" />;

  return (
    <View style={{ backgroundColor: c.card, borderRadius: iOSGroupedRadius, overflow: 'hidden' }}>
      {graphRows.map((row, idx) => (
        <CommitRow
          key={row.commit.hash}
          row={row}
          graphWidth={graphWidth}
          isHead={idx === 0}
          currentBranch={currentBranch}
          isLast={idx === graphRows.length - 1}
          onPress={() => onCommitPress(row.commit)}
          isLastRow={row.isLast}
        />
      ))}
    </View>
  );
}

function CommitRow({
  row,
  graphWidth,
  isHead,
  currentBranch,
  isLast,
  onPress,
  isLastRow,
}: {
  row: GraphRow;
  graphWidth: number;
  isHead: boolean;
  currentBranch?: string;
  isLast: boolean;
  onPress: () => void;
  isLastRow: boolean;
}) {
  const c = useThemeColors();
  const dotColor = LANE_COLORS[row.lane % LANE_COLORS.length];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        minHeight: ROW_HEIGHT,
        backgroundColor: pressed ? c.subtle : 'transparent',
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: c.separator,
      })}
    >
      <View style={{ width: graphWidth, height: ROW_HEIGHT }}>
        {row.verticalLines.map((vl) => {
          const lineContinues =
            !isLastRow || row.verticalLines.some((v) => v.lane === vl.lane && !v.isMine);
          return (
            <View
              key={vl.lane}
              style={{
                position: 'absolute',
                left: vl.lane * LANE_WIDTH + LANE_WIDTH / 2 - 0.75,
                top: 0,
                bottom: lineContinues ? 0 : ROW_HEIGHT / 2,
                width: 1.5,
                backgroundColor: vl.color,
              }}
            />
          );
        })}

        {row.forks.map((fork, fi) => (
          <View
            key={fi}
            style={{
              position: 'absolute',
              top: ROW_HEIGHT / 2,
              left: Math.min(fork.fromLane, fork.toLane) * LANE_WIDTH + LANE_WIDTH / 2,
              width: Math.abs(fork.toLane - fork.fromLane) * LANE_WIDTH,
              height: 1.5,
              backgroundColor: fork.color,
            }}
          />
        ))}

        <View
          style={{
            position: 'absolute',
            top: ROW_HEIGHT / 2 - (isHead ? 8 : 5),
            left: row.lane * LANE_WIDTH + LANE_WIDTH / 2 - (isHead ? 8 : 5),
            width: isHead ? 16 : 10,
            height: isHead ? 16 : 10,
            borderRadius: isHead ? 8 : 5,
            backgroundColor: dotColor,
            borderWidth: 2.5,
            borderColor: c.card,
          }}
        />
      </View>

      <View
        style={{
          flex: 1,
          paddingVertical: 10,
          paddingRight: Spacing.md,
          gap: 2,
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isHead && currentBranch && (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 4,
                backgroundColor: Colors.primary[500],
              }}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>
                HEAD
              </Text>
            </View>
          )}
          {row.commit.parents.length > 1 && (
            <View
              style={{
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderRadius: 3,
                backgroundColor: LANE_COLORS[(row.lane + 1) % LANE_COLORS.length] + '28',
              }}
            >
              <Text
                style={{
                  color: LANE_COLORS[(row.lane + 1) % LANE_COLORS.length],
                  fontSize: 8,
                  fontWeight: '700',
                }}
              >
                MERGE
              </Text>
            </View>
          )}
          <Text
            style={[Typography.subhead, { color: c.textPrimary, flex: 1 }]}
            numberOfLines={1}
          >
            {row.commit.message}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Text
            style={[
              Typography.caption2,
              { color: Colors.primary[500], fontFamily: 'Menlo', fontWeight: '600' },
            ]}
          >
            {row.commit.shortHash}
          </Text>
          <Text style={[Typography.caption2, { color: c.textTertiary }]} numberOfLines={1}>
            {row.commit.author.split(' ')[0]}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={[Typography.caption2, { color: c.textTertiary }]}>
            {formatDate(row.commit.date)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* ── Branches Tab ─────────────────────────────────────────────────────────── */

function BranchesTab({
  branches,
  currentBranch,
  onCheckout,
}: {
  branches: GitBranchesResult | null;
  currentBranch?: string;
  onCheckout: (b: string) => void;
}) {
  const c = useThemeColors();
  if (!branches) return <EmptyCard text="No branches loaded" />;

  return (
    <View style={{ backgroundColor: c.card, borderRadius: iOSGroupedRadius, overflow: 'hidden' }}>
      {branches.branches.map((branch, i) => (
        <BranchRow
          key={branch.name}
          branch={branch}
          isCurrent={branch.name === currentBranch}
          onPress={() => onCheckout(branch.name)}
          last={i === branches.branches.length - 1}
        />
      ))}
    </View>
  );
}

function BranchRow({
  branch,
  isCurrent,
  onPress,
  last,
}: {
  branch: GitBranch;
  isCurrent: boolean;
  onPress: () => void;
  last: boolean;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={isCurrent}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: 12,
        gap: Spacing.sm,
        backgroundColor: pressed ? c.subtle : isCurrent ? c.accentBg : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.separator,
        minHeight: 44,
      })}
    >
      <Ionicons
        name={isCurrent ? 'git-branch' : 'radio-button-off'}
        size={18}
        color={isCurrent ? Colors.primary[500] : c.textTertiary}
      />
      <Text
        style={[
          Typography.subhead,
          {
            color: isCurrent ? Colors.primary[500] : c.textPrimary,
            fontWeight: isCurrent ? '600' : '400',
            flex: 1,
          },
        ]}
        numberOfLines={1}
      >
        {branch.name}
      </Text>
      {branch.default && (
        <Text style={[Typography.caption2, { color: c.textTertiary, fontWeight: '600' }]}>
          default
        </Text>
      )}
      {!isCurrent && <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />}
    </Pressable>
  );
}

/* ── Toolbar ──────────────────────────────────────────────────────────────── */

function ToolbarBtn({
  icon,
  label,
  color,
  onPress,
  disabled,
  busy,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: CornerRadius.medium,
        backgroundColor: disabled ? c.subtle : pressed ? color + '28' : color + '14',
        minHeight: 44,
        opacity: disabled && !busy ? 0.5 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons name={icon as any} size={18} color={disabled ? c.textTertiary : color} />
      )}
      <Text
        style={[
          Typography.subhead,
          { color: disabled ? c.textTertiary : color, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ── Diff Modal ───────────────────────────────────────────────────────────── */

function DiffModal({
  state,
  onClose,
}: {
  state: { title: string; subtitle?: string; loading: boolean; diff: GitDiffResult | null } | null;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  if (!state) return null;

  const totalAdd = state.diff?.files.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = state.diff?.files.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: Spacing.md,
            paddingTop: insets.top + Spacing.sm,
            paddingBottom: Spacing.sm,
            gap: Spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: c.separator,
          }}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? c.subtle : 'transparent',
            })}
          >
            <Ionicons name="close" size={22} color={c.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}
              numberOfLines={1}
            >
              {state.title}
            </Text>
            {state.subtitle && (
              <Text style={[Typography.caption2, { color: c.textTertiary }]} numberOfLines={1}>
                {state.subtitle}
              </Text>
            )}
          </View>
          {state.diff && totalAdd + totalDel > 0 && (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {totalAdd > 0 && (
                <Text style={[Typography.caption2, { color: Colors.success[400], fontWeight: '700' }]}>
                  +{totalAdd}
                </Text>
              )}
              {totalDel > 0 && (
                <Text style={[Typography.caption2, { color: Colors.danger[400], fontWeight: '700' }]}>
                  −{totalDel}
                </Text>
              )}
            </View>
          )}
        </View>

        {state.loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={Colors.primary[500]} size="large" />
          </View>
        ) : !state.diff || state.diff.files.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }}>
            <Ionicons name="document-outline" size={40} color={c.textTertiary} />
            <Text style={[Typography.footnote, { color: c.textTertiary, marginTop: 12 }]}>
              No changes to display
            </Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom }}>
            {state.diff.files.map((file, fi) => (
              <FileDiffBlock key={file.path + fi} file={file} />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function FileDiffBlock({ file }: { file: GitFileDiff }) {
  const c = useThemeColors();
  const parts = file.path.split('/');
  const filename = parts.pop() ?? file.path;
  const dir = parts.join('/');

  return (
    <View style={{ gap: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
          paddingVertical: 10,
          gap: Spacing.sm,
          backgroundColor: c.elevated,
        }}
      >
        <Ionicons
          name={file.status === 'added' ? 'add-circle' : file.status === 'deleted' ? 'remove-circle' : 'create'}
          size={16}
          color={file.status === 'added' ? Colors.success[400] : file.status === 'deleted' ? Colors.danger[400] : Colors.primary[500]}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}
            numberOfLines={1}
          >
            {filename}
          </Text>
          {dir.length > 0 && (
            <Text
              style={[Typography.caption2, { color: c.textTertiary, fontFamily: 'Menlo' }]}
              numberOfLines={1}
            >
              {dir}/
            </Text>
          )}
        </View>
        {file.additions > 0 && (
          <Text style={[Typography.caption2, { color: Colors.success[400], fontWeight: '700' }]}>
            +{file.additions}
          </Text>
        )}
        {file.deletions > 0 && (
          <Text style={[Typography.caption2, { color: Colors.danger[400], fontWeight: '700' }]}>
            −{file.deletions}
          </Text>
        )}
      </View>

      {file.hunks.map((hunk, hi) => (
        <View key={hi}>
          <View
            style={{
              paddingHorizontal: Spacing.md,
              paddingVertical: 4,
              backgroundColor: c.subtle,
            }}
          >
            <Text
              style={[Typography.caption2, { color: c.textTertiary, fontFamily: 'Menlo' }]}
              numberOfLines={1}
            >
              {hunk.header}
            </Text>
          </View>
          {hunk.lines.map((line, li) => (
            <DiffLineRow key={li} line={line} />
          ))}
        </View>
      ))}
    </View>
  );
}

function DiffLineRow({ line }: { line: GitDiffLine }) {
  const c = useThemeColors();
  const bg =
    line.type === 'add'
      ? Colors.success[400] + '12'
      : line.type === 'remove'
        ? Colors.danger[400] + '12'
        : 'transparent';
  const textColor =
    line.type === 'add'
      ? Colors.success[400]
      : line.type === 'remove'
        ? Colors.danger[400]
        : c.textSecondary;
  const prefix =
    line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: bg,
        minHeight: 20,
      }}
    >
      <View
        style={{
          width: 36,
          alignItems: 'flex-end',
          paddingRight: 6,
          paddingVertical: 2,
        }}
      >
        <Text style={[Typography.caption2, { color: c.textTertiary, fontFamily: 'Menlo', fontSize: 10 }]}>
          {line.oldLine ?? ''}
        </Text>
      </View>
      <View
        style={{
          width: 36,
          alignItems: 'flex-end',
          paddingRight: 6,
          paddingVertical: 2,
          borderRightWidth: 1,
          borderRightColor: c.separator,
        }}
      >
        <Text style={[Typography.caption2, { color: c.textTertiary, fontFamily: 'Menlo', fontSize: 10 }]}>
          {line.newLine ?? ''}
        </Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text
          style={{
            color: textColor,
            fontFamily: 'Menlo',
            fontSize: 12,
            lineHeight: 18,
          }}
          numberOfLines={1}
        >
          {prefix} {line.content}
        </Text>
      </View>
    </View>
  );
}

/* ── Utils ────────────────────────────────────────────────────────────────── */

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
