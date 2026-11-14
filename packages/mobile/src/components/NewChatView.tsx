import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { AgentType } from '@baton/shared';
import { formatModelName } from '@baton/shared/utils';
import { useThemeColors } from '../hooks/useThemeColors';
import { useRecentStore } from '../stores/recent';
import { useAgentStore } from '../stores/agents';
import { apiFetch } from '../services/api';
import { wsService } from '../services/websocket';
import { Typography, Spacing, CornerRadius, Glass, Colors } from '../constants/theme';
import { DirectoryPicker } from './DirectoryPicker';
import { PopoverMenu, type MenuOption, type AnchorRect } from './messages/PopoverMenu';

const AGENT_OPTIONS: {
  type: AgentType;
  label: string;
  desc: string;
  icon: string;
  color: string;
}[] = [
  {
    type: 'claude-code',
    label: 'Claude Code',
    desc: 'Deep code work & reasoning',
    icon: 'sparkles',
    color: '#D97757',
  },
  { type: 'codex', label: 'Codex', desc: 'Fast execution & coding', icon: 'terminal', color: '#10A37F' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open multi-provider stack', icon: 'code-slash', color: '#6366F1' },
  {
    type: 'kiro',
    label: 'Kiro',
    desc: 'Amazon Kiro agent',
    icon: 'rocket',
    color: '#FF9900',
  },
  {
    type: 'antigravity',
    label: 'Antigravity',
    desc: "Google's terminal agent",
    icon: 'planet-outline',
    color: '#4285F4',
  },
  {
    type: 'pi',
    label: 'Pi',
    desc: 'Minimal coding agent',
    icon: 'flask-outline',
    color: '#8B5CF6',
  },
];

const STARTER_PROMPTS = [
  {
    icon: 'git-compare-outline' as const,
    title: 'Review changes',
    desc: 'Review all changed files and check for bugs',
    prompt: '/review',
  },
  {
    icon: 'flask-outline' as const,
    title: 'Run test suite',
    desc: 'Run tests across workspace and fix failures',
    prompt: 'Run the test suite and fix any failing tests',
  },
  {
    icon: 'cube-outline' as const,
    title: 'Architecture overview',
    desc: "Explain this project's structure and design",
    prompt: "Explain this project's architecture, key components, and data flow",
  },
  {
    icon: 'hammer-outline' as const,
    title: 'Build & verify',
    desc: 'Run typecheck, lint, and build',
    prompt: 'Run typecheck and lint to verify codebase health',
  },
];

interface NewChatViewProps {
  onStartSession: (sessionId: string) => void;
  onOpenSidebar?: () => void;
  onToggleSidebar?: () => void;
  isWide?: boolean;
}

export function NewChatView({
  onStartSession,
  onOpenSidebar,
  onToggleSidebar,
  isWide = false,
}: NewChatViewProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { sessions } = useRecentStore();
  const addAgent = useAgentStore((s) => s.addAgent);

  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude-code');
  const [projectPath, setProjectPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [input, setInput] = useState('');
  const [starting, setStarting] = useState(false);

  // Model & thinking state
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [thinkingMode, setThinkingMode] = useState<'none' | 'auto' | 'level'>('auto');
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high'>('medium');

  // Menu state
  const [modelMenu, setModelMenu] = useState<{
    anchor: AnchorRect;
  } | null>(null);
  const [thinkingMenu, setThinkingMenu] = useState<{
    anchor: AnchorRect;
  } | null>(null);

  const [startError, setStartError] = useState<string | null>(null);
  const inputRef = useRef<any>(null);
  const modelPillRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const thinkPillRef = useRef<React.ElementRef<typeof Pressable>>(null);

  // Fetch models for selected agent
  useEffect(() => {
    async function fetchModels() {
      try {
        const data = await apiFetch<{ models: string[] }>(`/api/agents/models?type=${selectedAgent}`);
        if (data?.models?.length) {
          setAvailableModels(data.models);
          if (!selectedModel) {
            setSelectedModel(data.models[0]);
          }
        }
      } catch {
        // Use defaults
      }
    }
    fetchModels();
  }, [selectedAgent]);

  // Reset model when agent changes
  useEffect(() => {
    setSelectedModel('');
  }, [selectedAgent]);

  // Default project path from recent sessions
  useEffect(() => {
    if (!projectPath && sessions.length > 0) {
      const recent = sessions.find((s) => s.projectPath);
      if (recent?.projectPath) {
        setProjectPath(recent.projectPath);
      }
    }
  }, [sessions, projectPath]);

  const activeMeta = useMemo(
    () => AGENT_OPTIONS.find((a) => a.type === selectedAgent) ?? AGENT_OPTIONS[0],
    [selectedAgent],
  );

  const thinkingBadge = useMemo(() => {
    if (thinkingMode === 'none') return 'No thinking';
    if (thinkingMode === 'auto') return 'Auto';
    return thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1);
  }, [thinkingMode, thinkingLevel]);

  const measureAnchor = useCallback(
    (ref: React.RefObject<any>): Promise<AnchorRect> => {
      return new Promise((resolve) => {
        if (ref.current) {
          ref.current.measureInWindow((x: number, y: number, width: number, height: number) => {
            resolve({ x, y, width, height });
          });
        } else {
          resolve({ x: 0, y: 0, width: 0, height: 0 });
        }
      });
    },
    [],
  );

  const openModelMenu = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const anchor = await measureAnchor(modelPillRef);

    // Deduplicate models
    const uniqueModels: string[] = [];
    const seenLabels = new Set<string>();
    for (const m of availableModels) {
      const label = formatModelName(m, { compact: true });
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        uniqueModels.push(m);
      }
    }

    const options: MenuOption[] = uniqueModels.map((m) => ({
      label: formatModelName(m, { compact: false }),
      selected: m === selectedModel,
    }));

    setModelMenu({
      anchor,
    });
  }, [availableModels, selectedModel, measureAnchor]);

  const openThinkingMenu = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const anchor = await measureAnchor(thinkPillRef);
    setThinkingMenu({ anchor });
  }, [measureAnchor]);

  const handleStart = async (customPrompt?: string) => {
    const promptText = (customPrompt ?? input).trim();
    if (!promptText && !customPrompt) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!projectPath) {
      setStartError('Choose a project directory first');
      return;
    }

    setStarting(true);
    setStartError(null);
    try {
      const data = await apiFetch<{ sessionId: string }>('/api/agents/start', {
        method: 'POST',
        body: JSON.stringify(
          // Kiro's PTY UI (v3 animation / "Initializing...") isn't parseable; its
          // `kiro-cli acp` JSON-RPC surface is (provider defined in ~/.baton/acp.json).
          selectedAgent === 'kiro'
            ? { agentType: 'acp', acpProvider: 'kiro', projectPath, mode: 'sdk' }
            : { agentType: selectedAgent, projectPath, mode: 'sdk' },
        ),
      });

      const sessionId = data.sessionId;
      addAgent({
        id: sessionId,
        type: selectedAgent,
        projectPath,
        status: 'running',
        startedAt: new Date().toISOString(),
        title: promptText ? promptText.slice(0, 40) : undefined,
      });

      // Apply the composer's choices, then deliver the first prompt.
      if (selectedModel) {
        wsService.send({ type: 'model_select', sessionId, model: selectedModel });
      }
      wsService.send({
        type: 'thinking_config_select',
        sessionId,
        config:
          thinkingMode === 'level'
            ? { mode: 'level', level: thinkingLevel }
            : { mode: thinkingMode },
      });
      if (promptText) {
        wsService.send({ type: 'chat_input', sessionId, content: promptText });
      }
      setInput('');
      onStartSession(sessionId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setStarting(false);
    }
  };

  const handleSelectPrompt = (prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput(prompt);
    inputRef.current?.focus();
  };

  const folderName = projectPath ? projectPath.split('/').pop() || projectPath : 'Choose Directory';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: c.bg }]}
    >
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.xs }]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={isWide ? onToggleSidebar : onOpenSidebar}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityLabel={isWide ? 'Toggle sidebar' : 'Open sidebar'}
          >
            <Ionicons name="reorder-three" size={24} color={c.textPrimary} />
          </Pressable>

          {/* Agent Selector Chip */}
          <View style={styles.agentChip}>
            <View style={[styles.agentDot, { backgroundColor: activeMeta.color }]} />
            <Text style={[styles.agentChipText, { color: c.textPrimary }]}>{activeMeta.label}</Text>
          </View>
        </View>

        {/* Directory Picker Button */}
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [
            styles.dirPickerBtn,
            {
              backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
              borderColor: c.cardBorder,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="folder-outline" size={13} color={c.textSecondary} />
          <Text style={[styles.dirText, { color: c.textSecondary }]} numberOfLines={1}>
            {folderName}
          </Text>
          <Ionicons name="chevron-down" size={11} color={c.textTertiary} />
        </Pressable>
      </View>

      {/* Main Body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.contentWrap}>
          {/* Hero Branding */}
          <View style={styles.heroSection}>
            <View style={[styles.heroIconBadge, { backgroundColor: activeMeta.color + '22' }]}>
              <Ionicons name={activeMeta.icon as any} size={32} color={activeMeta.color} />
            </View>
            <Text style={[styles.heroTitle, { color: c.textPrimary }]}>How can I help you code?</Text>
            <Text style={[styles.heroSubtitle, { color: c.textTertiary }]}>
              Selected: <Text style={{ color: activeMeta.color, fontWeight: '600' }}>{activeMeta.label}</Text> · {activeMeta.desc}
            </Text>
          </View>

          {/* Agent Picker Chips */}
          <View style={styles.agentSelectorWrap}>
            <Text style={[styles.sectionLabel, { color: c.textTertiary }]}>AVAILABLE AGENTS</Text>
            <View style={styles.agentGrid}>
              {AGENT_OPTIONS.map((a) => {
                const isPicked = a.type === selectedAgent;
                return (
                  <Pressable
                    key={a.type}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedAgent(a.type);
                    }}
                    style={({ pressed }) => [
                      styles.agentOptionCard,
                      {
                        backgroundColor: isPicked
                          ? c.isDark
                            ? 'rgba(255, 255, 255, 0.12)'
                            : 'rgba(0, 0, 0, 0.06)'
                          : c.isDark
                            ? 'rgba(255, 255, 255, 0.04)'
                            : 'rgba(0, 0, 0, 0.02)',
                        borderColor: isPicked ? a.color : c.cardBorder,
                        borderWidth: isPicked ? 1.5 : StyleSheet.hairlineWidth,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.agentOptionIcon, { backgroundColor: a.color + '20' }]}>
                      <Ionicons name={a.icon as any} size={15} color={a.color} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          styles.agentOptionTitle,
                          { color: isPicked ? c.textPrimary : c.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {a.label}
                      </Text>
                      <Text style={[styles.agentOptionDesc, { color: c.textTertiary }]} numberOfLines={2}>
                        {a.desc}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Starter Prompts */}
          <View style={styles.promptsSection}>
            <Text style={[styles.sectionLabel, { color: c.textTertiary }]}>SUGGESTIONS</Text>
            <View style={styles.promptsGrid}>
              {STARTER_PROMPTS.map((p) => (
                <Pressable
                  key={p.title}
                  onPress={() => handleSelectPrompt(p.prompt)}
                  style={({ pressed }) => [
                    styles.promptCard,
                    {
                      backgroundColor: c.isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(0, 0, 0, 0.03)',
                      borderColor: c.cardBorder,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View style={styles.promptHeader}>
                    <Ionicons name={p.icon} size={16} color={c.textSecondary} />
                    <Text style={[styles.promptTitle, { color: c.textPrimary }]}>{p.title}</Text>
                  </View>
                  <Text style={[styles.promptDesc, { color: c.textTertiary }]} numberOfLines={2}>
                    {p.desc}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Floating Bottom Composer (ChatGPT style) */}
      <View
        style={[
          styles.composerBar,
          {
            paddingBottom: Math.max(insets.bottom, 20) + Spacing.xs,
            borderTopColor: c.separator,
            backgroundColor: c.bg,
          },
        ]}
      >
        {/* Toolbar with model & thinking pills */}
        <View style={styles.toolbarRow}>
          <Pressable
            ref={modelPillRef}
            onPress={openModelMenu}
            style={({ pressed }) => [
              styles.toolbarPill,
              {
                backgroundColor: c.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.06)',
                borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            hitSlop={4}
          >
            <Ionicons name="cube-outline" size={11} color={c.textSecondary} />
            <Text style={[styles.toolbarPillText, { color: c.textSecondary }]} numberOfLines={1}>
              {selectedModel ? formatModelName(selectedModel, { compact: true }) : 'Model'}
            </Text>
            <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
          </Pressable>

          <Pressable
            ref={thinkPillRef}
            onPress={openThinkingMenu}
            style={({ pressed }) => [
              styles.toolbarPill,
              {
                backgroundColor:
                  thinkingMode !== 'none'
                    ? c.isDark
                      ? 'rgba(74,136,255,0.14)'
                      : 'rgba(38,102,235,0.10)'
                    : c.isDark
                      ? 'rgba(255,255,255,0.07)'
                      : 'rgba(60,60,67,0.06)',
                borderColor:
                  thinkingMode !== 'none'
                    ? c.isDark
                      ? 'rgba(74,136,255,0.35)'
                      : 'rgba(38,102,235,0.25)'
                    : c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            hitSlop={4}
          >
            <Ionicons
              name="bulb-outline"
              size={11}
              color={thinkingMode !== 'none' ? (c.isDark ? Colors.primary[300] : Colors.primary[500]) : c.textSecondary}
            />
            <Text
              style={[
                styles.toolbarPillText,
                {
                  color: thinkingMode !== 'none' ? (c.isDark ? Colors.primary[300] : Colors.primary[500]) : c.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              {thinkingBadge}
            </Text>
          </Pressable>
        </View>

        {startError ? (
          <Text style={{ color: Colors.danger[400], fontSize: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
            {startError}
          </Text>
        ) : null}
        <View style={styles.composerInnerWrap}>
          <View
            style={[
              styles.inputBox,
              {
                backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                borderColor: c.cardBorder,
              },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              placeholder={`Message ${activeMeta.label}...`}
              placeholderTextColor={c.textTertiary}
              style={[styles.inputField, { color: c.textPrimary }]}
              multiline
              maxLength={4000}
            />
            <Pressable
              onPress={() => handleStart()}
              disabled={!input.trim() || starting}
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: input.trim() && !starting ? c.accentBg : c.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {starting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons
                  name="arrow-up"
                  size={18}
                  color={input.trim() ? '#ffffff' : c.textTertiary}
                />
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {/* Model Menu Popover */}
      {modelMenu && (
        <PopoverMenu
          visible={true}
          title="Model"
          anchor={modelMenu.anchor}
          colors={c}
          options={(() => {
            const uniqueModels: string[] = [];
            const seenLabels = new Set<string>();
            for (const m of availableModels) {
              const label = formatModelName(m, { compact: true });
              if (!seenLabels.has(label)) {
                seenLabels.add(label);
                uniqueModels.push(m);
              }
            }
            return uniqueModels.map((m) => ({
              label: formatModelName(m, { compact: false }),
              selected: m === selectedModel,
            }));
          })()}
          onSelect={(index) => {
            const uniqueModels: string[] = [];
            const seenLabels = new Set<string>();
            for (const m of availableModels) {
              const label = formatModelName(m, { compact: true });
              if (!seenLabels.has(label)) {
                seenLabels.add(label);
                uniqueModels.push(m);
              }
            }
            if (index < uniqueModels.length) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedModel(uniqueModels[index]);
            }
            setModelMenu(null);
          }}
          onClose={() => setModelMenu(null)}
        />
      )}

      {/* Thinking Menu Popover */}
      {thinkingMenu && (
        <PopoverMenu
          visible={true}
          title="Thinking"
          anchor={thinkingMenu.anchor}
          colors={c}
          options={[
            { label: 'No thinking', selected: thinkingMode === 'none' },
            { label: 'Auto (default)', selected: thinkingMode === 'auto' },
            { separator: true },
            { label: 'Low', selected: thinkingMode === 'level' && thinkingLevel === 'low' },
            { label: 'Medium', selected: thinkingMode === 'level' && thinkingLevel === 'medium' },
            { label: 'High', selected: thinkingMode === 'level' && thinkingLevel === 'high' },
          ]}
          onSelect={(index) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (index === 0) {
              setThinkingMode('none');
            } else if (index === 1) {
              setThinkingMode('auto');
            } else if (index === 3) {
              setThinkingMode('level');
              setThinkingLevel('low');
            } else if (index === 4) {
              setThinkingMode('level');
              setThinkingLevel('medium');
            } else if (index === 5) {
              setThinkingMode('level');
              setThinkingLevel('high');
            }
            setThinkingMenu(null);
          }}
          onClose={() => setThinkingMenu(null)}
        />
      )}

      {/* Directory Picker Modal */}
      <DirectoryPicker
        visible={pickerOpen}
        initialPath={projectPath}
        onSelect={(p) => setProjectPath(p)}
        onClose={() => setPickerOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerBtn: {
    padding: 4,
    borderRadius: 8,
  },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  agentDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  agentChipText: {
    ...Typography.headline,
    fontSize: 16,
    fontWeight: '700',
  },
  dirPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: CornerRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 180,
  },
  dirText: {
    ...Typography.caption1,
    fontSize: 12,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
  },
  contentWrap: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.xl,
  },
  heroSection: {
    alignItems: 'center',
    gap: 10,
    paddingTop: Spacing.md,
  },
  heroIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    ...Typography.title1,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroSubtitle: {
    ...Typography.subhead,
    fontSize: 14,
    textAlign: 'center',
  },
  sectionLabel: {
    ...Typography.caption2,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  agentSelectorWrap: {
    gap: 4,
  },
  agentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: CornerRadius.medium,
    width: '48.5%',
    minHeight: 62,
  },
  agentOptionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentOptionTitle: {
    ...Typography.subhead,
    fontSize: 13,
    fontWeight: '600',
  },
  agentOptionDesc: {
    ...Typography.caption2,
    fontSize: 10,
    marginTop: 1,
  },
  promptsSection: {
    gap: 4,
  },
  promptsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  promptCard: {
    width: '48.5%',
    padding: 12,
    borderRadius: CornerRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  promptTitle: {
    ...Typography.subhead,
    fontSize: 13,
    fontWeight: '600',
  },
  promptDesc: {
    ...Typography.caption2,
    fontSize: 11,
    lineHeight: 15,
  },
  composerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs + 4,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  toolbarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolbarPillText: {
    ...Typography.caption1,
    fontSize: 12,
    fontWeight: '500',
  },
  composerInnerWrap: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 46,
  },
  inputField: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
