import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import { searchProjectFiles } from '../services/api';
import { FontFamily, Typography, Spacing, CornerRadius, Colors, Glass } from '../constants/theme';
import type { ThemeColors } from './messages';

export interface SlashCommand {
  name: string;
  description: string;
  icon: string;
  action?: 'review' | 'commit' | 'test' | 'fix' | 'plan' | 'compact';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/review',
    description: 'Review all changed files & unified diffs',
    icon: 'git-compare-outline',
    action: 'review',
  },
  {
    name: '/commit',
    description: 'Commit staged or working tree changes',
    icon: 'git-commit-outline',
    action: 'commit',
  },
  {
    name: '/test',
    description: 'Run project tests and report failures',
    icon: 'flask-outline',
    action: 'test',
  },
  {
    name: '/fix',
    description: 'Analyze and fix recent errors/diagnostics',
    icon: 'build-outline',
    action: 'fix',
  },
  {
    name: '/plan',
    description: 'Generate structured implementation plan',
    icon: 'list-outline',
    action: 'plan',
  },
  {
    name: '/compact',
    description: 'Compress context window history',
    icon: 'contract-outline',
    action: 'compact',
  },
];

export interface AgentInputAutocompleteProps {
  type: 'file' | 'command';
  query: string;
  projectPath: string;
  colors: ThemeColors;
  onSelect: (value: string, action?: string) => void;
  onClose?: () => void;
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'vue':
    case 'swift':
    case 'rs':
    case 'go':
    case 'py':
      return 'code-slash-outline';
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return 'code-working-outline';
    case 'md':
    case 'txt':
    case 'doc':
      return 'document-text-outline';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'webp':
      return 'image-outline';
    default:
      return 'document-outline';
  }
}

export const AgentInputAutocomplete: React.FC<AgentInputAutocompleteProps> = ({
  type,
  query,
  projectPath,
  colors: c,
  onSelect,
}) => {
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (type !== 'file' || !projectPath) {
      setFileResults([]);
      return;
    }

    setLoading(true);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const files = await searchProjectFiles(projectPath, query);
        setFileResults(files);
      } catch {
        setFileResults([]);
      } finally {
        setLoading(false);
      }
    }, 120);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [type, query, projectPath]);

  // Compute command suggestions
  const commandResults = React.useMemo(() => {
    if (type !== 'command') return [];
    const q = query.toLowerCase();
    return SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().includes(q));
  }, [type, query]);

  if (type === 'command' && commandResults.length === 0) return null;
  if (type === 'file' && !loading && fileResults.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
        },
      ]}
    >
      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={Glass.blur.tooltip}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: c.isDark
              ? Glass.opacity.dark.surface
              : Glass.opacity.light.surface,
            borderRadius: CornerRadius.medium,
          },
        ]}
        pointerEvents="none"
      />

      {/* Header bar */}
      <View
        style={[
          styles.headerRow,
          {
            borderBottomColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
          },
        ]}
      >
        <Ionicons
          name={type === 'file' ? 'attach-outline' : 'terminal-outline'}
          size={13}
          color={Colors.primary[500]}
        />
        <Text style={[styles.headerTitle, { color: c.textSecondary }]}>
          {type === 'file' ? 'Insert File Reference (@)' : 'Slash Commands (/)'}
        </Text>
        {loading && <ActivityIndicator size="small" color={Colors.primary[500]} style={{ marginLeft: 6 }} />}
      </View>

      {/* Suggestion list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled
      >
        {type === 'command' &&
          commandResults.map((cmd) => (
            <Pressable
              key={cmd.name}
              onPress={() => onSelect(cmd.name, cmd.action)}
              style={({ pressed }) => [
                styles.itemRow,
                {
                  backgroundColor: pressed
                    ? c.isDark
                      ? Glass.opacity.dark.subtle
                      : Glass.opacity.light.subtle
                    : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: Colors.primary[500] + '18' },
                ]}
              >
                <Ionicons name={cmd.icon as any} size={15} color={Colors.primary[500]} />
              </View>
              <View style={styles.itemTextCol}>
                <Text style={[styles.cmdName, { color: Colors.primary[500] }]}>
                  {cmd.name}
                </Text>
                <Text style={[styles.cmdDesc, { color: c.textTertiary }]} numberOfLines={1}>
                  {cmd.description}
                </Text>
              </View>
              <Ionicons name="return-down-back-outline" size={13} color={c.textTertiary} />
            </Pressable>
          ))}

        {type === 'file' &&
          fileResults.map((file) => {
            const parts = file.split('/');
            const filename = parts.pop() ?? file;
            const dir = parts.join('/');
            const icon = getFileIcon(file);

            return (
              <Pressable
                key={file}
                onPress={() => onSelect(`@${file} `)}
                style={({ pressed }) => [
                  styles.itemRow,
                  {
                    backgroundColor: pressed
                      ? c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle
                      : 'transparent',
                  },
                ]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    {
                      backgroundColor: c.isDark
                        ? Glass.opacity.dark.border
                        : Glass.opacity.light.border,
                    },
                  ]}
                >
                  <Ionicons name={icon as any} size={15} color={c.textSecondary} />
                </View>
                <View style={styles.itemTextCol}>
                  <Text style={[styles.fileName, { color: c.textPrimary }]} numberOfLines={1}>
                    {filename}
                  </Text>
                  {dir.length > 0 && (
                    <Text style={[styles.fileDir, { color: c.textTertiary }]} numberOfLines={1}>
                      {dir}/
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: CornerRadius.large,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.xs,
    maxHeight: 220,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  list: {
    maxHeight: 180,
  },
  listContent: {
    paddingVertical: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  cmdName: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FontFamily.mono,
  },
  cmdDesc: {
    fontSize: 11,
    marginTop: 1,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '500',
  },
  fileDir: {
    fontSize: 10,
    fontFamily: FontFamily.mono,
    marginTop: 1,
  },
});
