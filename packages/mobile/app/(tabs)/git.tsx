import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  View,
  Text,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useCallback, useEffect, useState } from 'react';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitBranchesResult,
} from '@baton/shared';
import { gitService } from '../../src/services/git';
import { wsService } from '../../src/services/websocket';
import { useConnectionStore } from '../../src/stores/connection';
import { useAgentStore } from '../../src/stores/agents';
import { useRecentStore } from '../../src/stores/recent';
import { useLayoutStore } from '../../src/stores/layout';
import {
  Typography,
  Spacing,
  CornerRadius,
  Colors,
  STATUS_COLORS,
} from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

export default function GitScreen() {
  const c = useThemeColors();
  const connected = useConnectionStore((s) => s.connected);
  const agents = useAgentStore((s) => s.agents);
  const recentSessions = useRecentStore((s) => s.sessions);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  // Collect project paths from active agents and recent sessions
  const projectPaths = Array.from(
    new Set([
      ...agents.map((a) => a.projectPath),
      ...recentSessions.map((s) => s.projectPath),
    ]),
  ).filter(Boolean);

  const [selectedPath, setSelectedPath] = useState(projectPaths[0] ?? '');
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<GitBranchesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [showBranches, setShowBranches] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedPath || !connected) return;
    setLoading(true);
    try {
      const [s, l, b] = await Promise.all([
        gitService.status(selectedPath).catch(() => null),
        gitService.log(selectedPath, 15).catch(() => null),
        gitService.branches(selectedPath).catch(() => null),
      ]);
      if (s) setStatus(s);
      if (l) setLog(l.entries);
      if (b) setBranches(b);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, [selectedPath, connected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCommit() {
    if (!selectedPath) return;
    try {
      await gitService.commit({ projectPath: selectedPath, message: commitMsg || undefined, all: true });
      setCommitMsg('');
      await refresh();
    } catch (err) {
      Alert.alert('Commit Failed', String(err));
    }
  }

  async function handlePush() {
    if (!selectedPath) return;
    try {
      const result = await gitService.push(selectedPath);
      if (!result.success) Alert.alert('Push Failed', result.output);
      await refresh();
    } catch (err) {
      Alert.alert('Push Failed', String(err));
    }
  }

  async function handlePull() {
    if (!selectedPath) return;
    try {
      const result = await gitService.pull(selectedPath);
      if (result.conflict) Alert.alert('Conflict', 'Merge conflict detected');
      await refresh();
    } catch (err) {
      Alert.alert('Pull Failed', String(err));
    }
  }

  async function handleStash() {
    if (!selectedPath) return;
    try {
      await gitService.stash(selectedPath);
      await refresh();
    } catch (err) {
      Alert.alert('Stash Failed', String(err));
    }
  }

  async function handleStashPop() {
    if (!selectedPath) return;
    try {
      await gitService.stashPop(selectedPath);
      await refresh();
    } catch (err) {
      Alert.alert('Stash Pop Failed', String(err));
    }
  }

  async function handleCheckout(branch: string) {
    if (!selectedPath) return;
    try {
      await gitService.checkout({ projectPath: selectedPath, branch });
      setShowBranches(false);
      await refresh();
    } catch (err) {
      Alert.alert('Checkout Failed', String(err));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + tabBarHeight + Spacing.lg,
          gap: Spacing.md,
        }}
      >
        <Text style={[Typography.largeTitle, { color: c.textPrimary }]}>Git</Text>

        {/* Project path selector */}
        <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase' }]}>
          Project
        </Text>
        <View style={{ backgroundColor: c.card, borderRadius: CornerRadius.large, overflow: 'hidden' }}>
          {projectPaths.length === 0 && (
            <View style={{ padding: Spacing.lg }}>
              <Text style={[Typography.footnote, { color: c.textSecondary }]}>
                Start an agent first to see project paths
              </Text>
            </View>
          )}
          {projectPaths.map((path, i) => {
            const active = selectedPath === path;
            return (
              <Pressable
                key={path}
                onPress={() => setSelectedPath(path)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: Spacing.lg,
                  gap: Spacing.sm,
                  backgroundColor: pressed ? c.subtle : active ? c.accentBg : 'transparent',
                })}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={active ? Colors.primary[500] : c.textTertiary}
                />
                <Text
                  style={[
                    Typography.footnote,
                    { color: active ? Colors.primary[500] : c.textPrimary, fontFamily: 'Menlo', flex: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {path}
                </Text>
                {i < projectPaths.length - 1 && <View />}
              </Pressable>
            );
          })}
        </View>

        {loading && !status && (
          <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={Colors.primary[500]} />
          </View>
        )}

        {/* Branch & Status */}
        {status && (
          <>
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: CornerRadius.large,
                padding: Spacing.lg,
                gap: Spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  <Ionicons name="git-branch" size={18} color={Colors.primary[500]} />
                  <Text style={[Typography.headline, { color: c.textPrimary, fontWeight: '600' }]}>
                    {status.branch}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowBranches(!showBranches)}
                  style={{
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.sm,
                    borderRadius: CornerRadius.medium,
                    backgroundColor: c.elevated,
                  }}
                >
                  <Text style={[Typography.caption1, { color: c.textSecondary }]}>
                    {branches?.branches.length ?? 0} branches
                  </Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                {status.tracking && (
                  <Text style={[Typography.caption1, { color: c.textTertiary }]}>
                    tracking: {status.tracking}
                  </Text>
                )}
                {status.ahead > 0 && (
                  <Text style={[Typography.caption1, { color: Colors.success[400] }]}>
                    ahead {status.ahead}
                  </Text>
                )}
                {status.behind > 0 && (
                  <Text style={[Typography.caption1, { color: Colors.danger[400] }]}>
                    behind {status.behind}
                  </Text>
                )}
              </View>

              {status.dirty && (
                <Text style={[Typography.footnote, { color: c.textSecondary }]}>
                  {status.files.length} changed file{status.files.length !== 1 ? 's' : ''}
                </Text>
              )}

              {!status.dirty && (
                <Text style={[Typography.footnote, { color: Colors.success[400] }]}>
                  Working tree clean
                </Text>
              )}
            </View>

            {/* Branch list (collapsible) */}
            {showBranches && branches && (
              <View style={{ backgroundColor: c.card, borderRadius: CornerRadius.large, overflow: 'hidden' }}>
                {branches.branches.map((branch: GitBranch) => (
                  <Pressable
                    key={branch.name}
                    onPress={() => !branch.current && handleCheckout(branch.name)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: Spacing.lg,
                      gap: Spacing.sm,
                      backgroundColor: pressed ? c.subtle : branch.current ? c.accentBg : 'transparent',
                    })}
                  >
                    <Ionicons
                      name={branch.current ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={branch.current ? Colors.primary[500] : c.textTertiary}
                    />
                    <Text
                      style={[
                        Typography.subhead,
                        {
                          color: branch.current ? Colors.primary[500] : c.textPrimary,
                          fontWeight: branch.current ? '600' : '400',
                        },
                      ]}
                    >
                      {branch.name}
                    </Text>
                    {branch.default && (
                      <Text style={[Typography.caption2, { color: c.textTertiary }]}>(default)</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {/* Changed files */}
            {status.files.length > 0 && (
              <View style={{ backgroundColor: c.card, borderRadius: CornerRadius.large, overflow: 'hidden' }}>
                <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
                  <Text style={[Typography.subhead, { color: c.textSecondary, fontWeight: '600' }]}>
                    Changes
                  </Text>
                </View>
                {status.files.slice(0, 20).map((file) => {
                  const icon =
                    file.status === 'added'
                      ? 'add-circle'
                      : file.status === 'deleted'
                        ? 'remove-circle'
                        : file.status === 'renamed'
                          ? 'arrow-forward'
                          : 'create';
                  const color =
                    file.status === 'added'
                      ? Colors.success[400]
                      : file.status === 'deleted'
                        ? Colors.danger[400]
                        : Colors.primary[500];
                  return (
                    <View
                      key={file.path}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: Spacing.lg,
                        paddingVertical: 8,
                        gap: Spacing.sm,
                      }}
                    >
                      <Ionicons name={icon as any} size={16} color={color} />
                      <Text
                        style={[Typography.footnote, { color: c.textPrimary, fontFamily: 'Menlo', flex: 1 }]}
                        numberOfLines={1}
                      >
                        {file.path}
                      </Text>
                      <Text style={[Typography.caption2, { color, fontWeight: '600' }]}>{file.status}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Actions */}
            <View style={{ gap: Spacing.sm }}>
              <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                Actions
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <ActionBtn label="Push" icon="arrow-up" onPress={handlePush} color={Colors.primary[500]} disabled={!connected} />
                <ActionBtn label="Pull" icon="arrow-down" onPress={handlePull} color={Colors.success[400]} disabled={!connected} />
                <ActionBtn label="Stash" icon="archive" onPress={handleStash} color={Colors.primary[500]} disabled={!connected} />
                <ActionBtn label="Pop" icon="archive-outline" onPress={handleStashPop} color={c.textSecondary} disabled={!connected} />
              </View>

              <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                <TextInput
                  style={{
                    flex: 1,
                    backgroundColor: c.inputBg,
                    borderColor: c.inputBorder,
                    borderWidth: 1,
                    borderRadius: CornerRadius.medium,
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.md,
                    fontSize: Typography.body.fontSize,
                    color: c.textPrimary,
                    minHeight: 44,
                    fontFamily: 'Menlo',
                  }}
                  placeholder="Commit message"
                  placeholderTextColor={c.textTertiary}
                  value={commitMsg}
                  onChangeText={setCommitMsg}
                  returnKeyType="done"
                />
                <ActionBtn
                  label="Commit"
                  icon="checkmark"
                  onPress={handleCommit}
                  color={Colors.primary[500]}
                  disabled={!connected || !status?.dirty}
                />
              </View>
            </View>

            {/* Commit log */}
            {log.length > 0 && (
              <View style={{ gap: Spacing.sm }}>
                <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                  Recent Commits
                </Text>
                <View style={{ backgroundColor: c.card, borderRadius: CornerRadius.large, overflow: 'hidden' }}>
                  {log.map((entry: GitLogEntry, i: number) => (
                    <View
                      key={entry.hash}
                      style={{
                        paddingHorizontal: Spacing.lg,
                        paddingVertical: 10,
                        gap: 2,
                        borderBottomWidth: i < log.length - 1 ? 1 : 0,
                        borderBottomColor: c.separator,
                      }}
                    >
                      <Text style={[Typography.subhead, { color: c.textPrimary }]} numberOfLines={1}>
                        {entry.message}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                        <Text style={[Typography.caption2, { color: Colors.primary[500], fontFamily: 'Menlo' }]}>
                          {entry.shortHash}
                        </Text>
                        <Text style={[Typography.caption2, { color: c.textTertiary }]}>{entry.author}</Text>
                        <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                          {formatDate(entry.date)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ActionBtn({
  label,
  icon,
  onPress,
  color,
  disabled,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: CornerRadius.medium,
        backgroundColor: disabled ? c.subtle : color + '18',
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon as any} size={16} color={disabled ? c.textTertiary : color} />
      <Text style={[Typography.subhead, { color: disabled ? c.textTertiary : color, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
