import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from './messages/TypingIndicator';
import { apiFetch } from '../services/api';
import { useAgentStore } from '../stores/agents';
import { Typography, Spacing, Radius, Colors, Glass, FontFamily } from '../constants/theme';

export interface WorktreeInfo {
  id: string;
  basePath: string;
  branch: string;
  path: string;
  status: 'active' | 'archived';
  createdAt: string;
}

/**
 * Parallel worktree tabs — one strip per project. Each tab shows the branch
 * name plus a live badge of agents running inside that worktree; the active
 * tab carries the primary accent. Renders as a plain (non-scrolling) row
 * while a single worktree exists, scrolls once branches multiply.
 */
export function WorktreeTabStrip({
  c,
  projectPath,
  activePath,
  onSelect,
}: {
  c: ThemeColors;
  /** Repo root (agent projectPath) — worktrees are matched by this base. */
  projectPath: string;
  /** Currently open worktree path; defaults to projectPath itself. */
  activePath?: string;
  onSelect: (worktree: WorktreeInfo | null) => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);

  const fetchList = useCallback(async () => {
    try {
      const list = await apiFetch<WorktreeInfo[]>('/api/worktree/list?status=active');
      setWorktrees(list);
    } catch {
      // offline — keep last known list
    }
  }, []);

  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, 10_000);
    return () => clearInterval(t);
  }, [fetchList]);

  // Only strips for this project's worktrees (incl. the main checkout).
  const mine = worktrees.filter((w) => w.basePath === projectPath);
  if (mine.length === 0) return null;

  const agentsIn = (path: string) =>
    agents.filter((a) => a.projectPath === path && a.status !== 'stopped');

  const isSelected = (path: string) => (activePath ?? projectPath) === path;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {mine.map((w) => {
        const selected = isSelected(w.path);
        const running = agentsIn(w.path).length;
        const isMain = w.path === w.basePath;
        const branch = isMain ? 'main checkout' : w.branch;
        return (
          <Pressable
            key={w.id}
            onPress={() => onSelect(w)}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: selected
                  ? Colors.primary[500] + (c.isDark ? '2E' : '1F')
                  : c.isDark
                    ? Glass.opacity.dark.subtle
                    : Glass.opacity.light.subtle,
                borderColor: selected
                  ? c.isDark
                    ? Glass.opacity.dark.borderActive
                    : Glass.opacity.light.borderActive
                  : c.isDark
                    ? Glass.opacity.dark.border
                    : Glass.opacity.light.border,
                opacity: pressed ? 0.75 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Ionicons
              name={isMain ? 'home-outline' : 'git-branch-outline'}
              size={12}
              color={selected ? Colors.primary[500] : c.textTertiary}
            />
            <Text
              style={[
                styles.tabText,
                {
                  color: selected ? Colors.primary[500] : c.textSecondary,
                },
                !isMain && styles.tabTextMono,
              ]}
              numberOfLines={1}
            >
              {branch}
            </Text>
            {running > 0 && (
              <View style={[styles.badge, { backgroundColor: Colors.success[400] + '2E' }]}>
                <Text style={[styles.badgeText, { color: Colors.success[400] }]}>{running}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: Spacing.sm - 2,
    paddingVertical: 2,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md - 2,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    minHeight: 30,
  },
  tabText: {
    ...Typography.caption2,
    fontWeight: '600',
    maxWidth: 120,
  },
  tabTextMono: {
    fontFamily: FontFamily.mono,
  },
  badge: {
    minWidth: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
