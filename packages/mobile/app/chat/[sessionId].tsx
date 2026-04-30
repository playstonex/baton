import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  FlatList,
  Pressable,
  View,
  Text,
  Modal,
  ActionSheetIOS,
  Alert,
  Linking,
  Clipboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { wsService } from '../../src/services/websocket';
import { useChatStore, type ChatMessage } from '../../src/stores/chat';
import { STATUS_COLORS } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import {
  MarkdownText,
  ThinkingBlock,
  ToolCallCard,
  FileChangeRow,
  CommandExecCard,
  TypingIndicator,
  DiffRenderer,
  PlanCard,
  ToolBurstGroup,
  SubagentActionCard,
  PopoverMenu,
  type ThemeColors,
  type MenuOption,
} from '../../src/components/messages';

type ThinkingMode = 'none' | 'auto' | 'level';
type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type AccessMode = 'on-request' | 'full-access';
type ServiceTier = 'default' | 'fast';
type RuntimeMode = 'local' | 'cloud';

type GroupedItem =
  | { type: 'message'; msg: ChatMessage }
  | { type: 'burst'; id: string; messages: ChatMessage[]; turnId: string };

const PAGE_SIZE = 40;
const TOOL_BURST_THRESHOLD = 3;
const SCROLL_BOTTOM_THRESHOLD = 120;

const THINKING_LEVEL_SHORT: Record<string, string> = {
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHi',
};

const isRunning = (s: string) => s === 'running' || s === 'thinking' || s === 'executing';

const HEADER_HEIGHT = 48;

const RING_SIZE = 20;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextProgressRing({
  fraction,
  color,
}: {
  fraction: number;
  color: string;
}) {
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - Math.min(fraction, 1));
  const pct = Math.round(fraction * 100);

  let ringColor = color;
  if (fraction > 0.85) ringColor = '#ef4444';
  else if (fraction > 0.65) ringColor = '#ff9500';

  return (
    <View style={progressStyles.container}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={color}
          strokeWidth={RING_STROKE}
          fill="none"
          opacity={0.2}
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={ringColor}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <Text style={[progressStyles.label, { color: ringColor }]}>
        {pct}
      </Text>
    </View>
  );
}

const progressStyles = StyleSheet.create({
  container: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    fontSize: 7,
    fontWeight: '600',
  },
});

function showActionSheet(
  title: string,
  options: string[],
  cancelButtonIndex: number,
  onSelect: (index: number) => void,
  destructiveIndex?: number,
  message?: string,
) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options, cancelButtonIndex, destructiveButtonIndex: destructiveIndex ?? -1, message },
      onSelect,
    );
  } else {
    const buttons = options.filter((_, i) => i !== cancelButtonIndex);
    Alert.alert(title, message, [
      ...buttons.map((label, i) => ({
        text: label,
        onPress: () => onSelect(i >= cancelButtonIndex ? i + 1 : i),
      })),
      { text: options[cancelButtonIndex], style: 'cancel' as const },
    ]);
  }
}

function shortModelName(model: string | null): string {
  if (!model) return 'Model';
  const parts = model.split('-');
  return parts.length > 1 ? parts.slice(-2).join('-') : model;
}

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const messages = useChatStore((s) => s.messages);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const waitingApproval = useChatStore((s) => s.waitingApproval);
  const addEvent = useChatStore((s) => s.addEvent);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const setStatus = useChatStore((s) => s.setStatus);
  const setWaitingApproval = useChatStore((s) => s.setWaitingApproval);
  const clear = useChatStore((s) => s.clear);
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('level');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium');
  const [serviceTier, setServiceTier] = useState<ServiceTier>('default');
  const [accessMode, setAccessMode] = useState<AccessMode>('on-request');
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('local');
  const [planMode, setPlanMode] = useState(false);
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [contextFraction, setContextFraction] = useState(0);
  const [projectPath, setProjectPath] = useState('');
  const [gitStatus, setGitStatus] = useState('');
  const [gitDiff, setGitDiff] = useState('');
  const [approvalDetail, setApprovalDetail] = useState<{ toolName: string; detail: string } | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{ prompt: number; completion: number; total: number } | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(new Set());
  const [promptModal, setPromptModal] = useState<{ visible: boolean; title: string; placeholder: string; onSubmit: (text: string) => void } | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ title?: string; options: MenuOption[]; onSelect: (i: number) => void; anchor?: { x: number; y: number; width: number; height: number } } | null>(null);
  const flatRef = useRef<FlatList>(null);
  const attachBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const reasoningBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const runtimeBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const accessBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const branchBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const gitActionsBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const modelBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const insets = useSafeAreaInsets();
  const c = useThemeColors();

  const measureAnchor = (
    ref: React.RefObject<React.ElementRef<typeof Pressable> | null>,
  ): Promise<{ x: number; y: number; width: number; height: number }> =>
    new Promise((resolve) => {
      ref.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
        resolve({ x, y, width, height });
      });
    });

  const attachSession = useCallback(() => {
    if (!sessionId) return;
    wsService.send({ type: 'control', action: 'attach_session', sessionId });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    clear();
    setVisibleCount(PAGE_SIZE);
    setExpandedBursts(new Set());

    const unsubEvent = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        addEvent(msg.event);
        if (msg.event.type === 'waiting_approval') {
          const ev = msg.event as unknown as Record<string, unknown>;
          const meta = ev.meta as Record<string, unknown> | undefined;
          if (meta) {
            setApprovalDetail({ toolName: String(meta.toolName ?? ''), detail: String(meta.detail ?? '') });
          }
        }
        if (msg.event.type === 'token_usage') {
          const te = msg.event as { promptTokens: number; completionTokens: number; totalTokens: number };
          setTokenUsage({ prompt: te.promptTokens, completion: te.completionTokens, total: te.totalTokens });
        }
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && msg.sessionId === sessionId) {
        setStatus(msg.status as string);
      }
    });

    const unsubState = wsService.on('_state', () => {
      if (wsService.connected) attachSession();
    });

    const unsubModels = wsService.on('model_list', (msg) => {
      if (msg.type === 'model_list' && msg.sessionId === sessionId) {
        setModels(msg.models);
        if (msg.selected) setSelectedModel(msg.selected);
      }
    });

    const unsubGitBranches = wsService.on('git_branch_list', (msg) => {
      if (msg.type === 'git_branch_list' && msg.sessionId === sessionId) {
        setGitBranches(msg.branches ?? []);
        if (msg.currentBranch) setCurrentBranch(msg.currentBranch);
      }
    });

    const unsubGitStatus = wsService.on('git_status', (msg) => {
      if (msg.type === 'git_status' && msg.sessionId === sessionId) {
        setGitStatus(msg.status ?? '');
        setGitDiff(msg.diff ?? '');
        if (msg.projectPath) setProjectPath(msg.projectPath);
      }
    });

    const unsubGitResult = wsService.on('git_result', (msg) => {
      if (msg.type === 'git_result' && msg.sessionId === sessionId) {
        if (msg.success) {
          wsService.send({ type: 'git_status_request', sessionId });
          wsService.send({ type: 'git_branch_list_request', sessionId });
        } else {
          setErrorToast(msg.error ?? 'Operation failed');
        }
      }
    });

    if (wsService.connected) {
      attachSession();
      wsService.send({ type: 'model_list_request', sessionId });
      wsService.send({ type: 'git_branch_list_request', sessionId });
      wsService.send({ type: 'git_status_request', sessionId });
    }

    return () => {
      unsubEvent();
      unsubStatus();
      unsubState();
      unsubModels();
      unsubGitBranches();
      unsubGitStatus();
      unsubGitResult();
    };
  }, [sessionId, addEvent, setStatus, clear, attachSession]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => flatRef.current?.scrollToEnd({ animated: false }));
    }
  }, []);

  useEffect(() => {
    if (errorToast) {
      const t = setTimeout(() => setErrorToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [errorToast]);

  useEffect(() => {
    if (messages.length > 0 && isNearBottom) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    }
    if (tokenUsage) {
      const estimatedFraction = Math.min(tokenUsage.total / 200000, 1);
      setContextFraction(estimatedFraction > 0.01 ? estimatedFraction : 0);
    } else {
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      const estimatedFraction = Math.min(totalChars / 200000, 1);
      setContextFraction(estimatedFraction > 0.01 ? estimatedFraction : 0);
    }
  }, [messages.length, tokenUsage, isNearBottom]);

  const paginatedMessages = useMemo(() => {
    const start = Math.max(0, messages.length - visibleCount);
    return messages.slice(start);
  }, [messages, visibleCount]);

  const hasMore = messages.length > visibleCount;

  const groupedData = useMemo(() => {
    const result: GroupedItem[] = [];
    let currentBurst: ChatMessage[] = [];

    const flushBurst = () => {
      if (currentBurst.length === 0) return;
      if (currentBurst.length >= TOOL_BURST_THRESHOLD) {
        result.push({
          type: 'burst',
          id: `burst-${currentBurst[0].id}`,
          messages: [...currentBurst],
          turnId: currentBurst[0].turnId,
        });
      } else {
        for (const m of currentBurst) {
          result.push({ type: 'message', msg: m });
        }
      }
      currentBurst = [];
    };

    for (const msg of paginatedMessages) {
      const isToolLike =
        msg.kind === 'toolActivity' ||
        msg.kind === 'fileChange' ||
        msg.kind === 'commandExecution';
      if (isToolLike) {
        currentBurst.push(msg);
      } else {
        flushBurst();
        result.push({ type: 'message', msg });
      }
    }
    flushBurst();
    return result;
  }, [paginatedMessages]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    setIsNearBottom(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD);
  }, []);

  function loadEarlier() {
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, messages.length));
  }

  function scrollToBottom() {
    flatRef.current?.scrollToEnd({ animated: true });
    setIsNearBottom(true);
  }

  function toggleBurst(burstId: string) {
    setExpandedBursts((prev) => {
      const next = new Set(prev);
      if (next.has(burstId)) {
        next.delete(burstId);
      } else {
        next.add(burstId);
      }
      return next;
    });
  }

  function showMessageActions(msg: ChatMessage) {
    const options = ['Copy Message'];
    if (msg.role === 'user') {
      options.push('Retry');
    }
    if (msg.role === 'assistant') {
      options.push('Select Text');
    }
    options.push('Cancel');
    showActionSheet('Actions', options, options.length - 1, (index) => {
      if (index === 0) {
        Clipboard.setString(msg.content);
      }
      if (index === 1 && msg.role === 'user') {
        setInput(msg.content);
      }
    });
  }

  function sendChat() {
    if (!input.trim() || !sessionId) return;
    addUserMessage(input.trim());
    sendThinkingConfig(thinkingMode, thinkingLevel);
    if (serviceTier !== 'default') {
      wsService.send({ type: 'service_tier_select', sessionId, tier: serviceTier });
    }
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    wsService.send({ type: 'chat_input', sessionId, content: input.trim(), model: selectedModel ?? undefined, messageId });
    setInput('');
  }

  function sendSteer() {
    if (!input.trim() || !sessionId) return;
    addUserMessage(input.trim());
    wsService.send({ type: 'steer_input', sessionId, content: input.trim() });
    setInput('');
  }

  function cancelTurn() {
    if (!sessionId) return;
    wsService.send({ type: 'cancel_turn', sessionId });
  }

  function approveAction() {
    if (!sessionId) return;
    wsService.send({ type: 'approve_input', sessionId });
    setWaitingApproval(false);
    setApprovalDetail(null);
  }

  function rejectAction() {
    if (!sessionId) return;
    wsService.send({ type: 'reject_input', sessionId });
    setWaitingApproval(false);
    setApprovalDetail(null);
  }

  async function openAttachmentMenu() {
    const anchor = await measureAnchor(attachBtnRef);
    setMenu({
      title: 'Attach',
      anchor,
      options: [
        { label: planMode ? '\u2713 Plan Mode' : 'Plan Mode', selected: planMode },
        { label: 'Photo Library', disabled: true },
        { label: 'Take Photo', disabled: true },
      ],
      onSelect: (index) => {
        if (index === 0) setPlanMode(!planMode);
      },
    });
  }

  async function openReasoningMenu() {
    const anchor = await measureAnchor(reasoningBtnRef);
    const options: MenuOption[] = [
      { label: `${thinkingMode === 'none' ? '\u2713 ' : ''}Off`, selected: thinkingMode === 'none' },
      { label: `${thinkingMode === 'auto' ? '\u2713 ' : ''}Auto`, selected: thinkingMode === 'auto' },
      { separator: true },
      { label: `${thinkingMode === 'level' && thinkingLevel === 'minimal' ? '\u2713 ' : ''}Minimal`, selected: thinkingMode === 'level' && thinkingLevel === 'minimal' },
      { label: `${thinkingMode === 'level' && thinkingLevel === 'low' ? '\u2713 ' : ''}Low`, selected: thinkingMode === 'level' && thinkingLevel === 'low' },
      { label: `${thinkingMode === 'level' && thinkingLevel === 'medium' ? '\u2713 ' : ''}Medium`, selected: thinkingMode === 'level' && thinkingLevel === 'medium' },
      { label: `${thinkingMode === 'level' && thinkingLevel === 'high' ? '\u2713 ' : ''}High`, selected: thinkingMode === 'level' && thinkingLevel === 'high' },
      { label: `${thinkingMode === 'level' && thinkingLevel === 'xhigh' ? '\u2713 ' : ''}X-High`, selected: thinkingMode === 'level' && thinkingLevel === 'xhigh' },
      { separator: true },
      { label: 'Normal Speed', selected: serviceTier === 'default' },
      { label: 'Fast Speed', selected: serviceTier === 'fast' },
    ];
    setMenu({
      title: 'Thinking & Speed',
      anchor,
      options,
      onSelect: (index) => {
        if (index === 0) { setThinkingMode('none'); sendThinkingConfig('none'); }
        else if (index === 1) { setThinkingMode('auto'); sendThinkingConfig('auto'); }
        else if (index === 3) { setThinkingMode('level'); setThinkingLevel('minimal'); sendThinkingConfig('level', 'minimal'); }
        else if (index === 4) { setThinkingMode('level'); setThinkingLevel('low'); sendThinkingConfig('level', 'low'); }
        else if (index === 5) { setThinkingMode('level'); setThinkingLevel('medium'); sendThinkingConfig('level', 'medium'); }
        else if (index === 6) { setThinkingMode('level'); setThinkingLevel('high'); sendThinkingConfig('level', 'high'); }
        else if (index === 7) { setThinkingMode('level'); setThinkingLevel('xhigh'); sendThinkingConfig('level', 'xhigh'); }
        else if (index === 8) { setThinkingMode('level'); setThinkingLevel('medium'); }
        else if (index === 9) { setServiceTier('default'); wsService.send({ type: 'service_tier_select', sessionId, tier: 'default' }); }
        else if (index === 10) { setServiceTier('fast'); wsService.send({ type: 'service_tier_select', sessionId, tier: 'fast' }); }
      },
    });
  }

  function sendThinkingConfig(mode: ThinkingMode, level?: ThinkingLevel) {
    if (!sessionId) return;
    wsService.send({
      type: 'thinking_config_select',
      sessionId,
      config: mode === 'none' ? { mode: 'none' }
        : mode === 'auto' ? { mode: 'auto' }
        : { mode: 'level', level: level ?? 'medium' },
    });
  }

  async function openRuntimePicker() {
    const anchor = await measureAnchor(runtimeBtnRef);
    setMenu({
      title: 'Continue in',
      anchor,
      options: [
        { label: 'Cloud', selected: runtimeMode === 'cloud' },
        { label: 'Local', selected: runtimeMode === 'local' },
      ],
      onSelect: (index) => {
        if (index === 0) {
          setRuntimeMode('cloud');
          Linking.openURL('https://chatgpt.com/codex').catch(() => {});
        }
        if (index === 1) {
          setRuntimeMode('local');
        }
      },
    });
  }

  async function openAccessModeMenu() {
    const anchor = await measureAnchor(accessBtnRef);
    setMenu({
      title: 'Access Mode',
      anchor,
      options: [
        { label: 'Ask (On-Request)', selected: accessMode === 'on-request' },
        { label: 'Full Access', selected: accessMode === 'full-access' },
      ],
      onSelect: (index) => {
        if (index === 0) {
          setAccessMode('on-request');
          wsService.send({ type: 'access_mode_select', sessionId, mode: 'on-request' });
        }
        if (index === 1) {
          setAccessMode('full-access');
          wsService.send({ type: 'access_mode_select', sessionId, mode: 'full-access' });
        }
      },
    });
  }

  async function openGitBranchMenu() {
    const anchor = await measureAnchor(branchBtnRef);
    const displayBranches = gitBranches.slice(0, 7);
    const options: MenuOption[] = displayBranches.map((b) => ({
      label: b,
      selected: b === currentBranch,
    }));
    options.push({ separator: true });
    options.push({ label: 'Create Branch...' });
    setMenu({
      title: 'Git Branch',
      anchor,
      options,
      onSelect: (index) => {
        if (index === displayBranches.length + 1) {
          setPromptModal({ visible: true, title: 'Create Branch', placeholder: 'Branch name', onSubmit: (name) => {
            if (name.trim()) {
              wsService.send({ type: 'git_create_branch', sessionId, name: name.trim() });
            }
          }});
          return;
        }
        if (index < displayBranches.length && displayBranches[index] !== currentBranch) {
          setCurrentBranch(displayBranches[index]);
          wsService.send({ type: 'git_branch_select', sessionId, branch: displayBranches[index] });
        }
      },
    });
  }

  async function openGitActionsMenu() {
    const anchor = await measureAnchor(gitActionsBtnRef);
    setMenu({
      title: 'Git Actions',
      anchor,
      options: [
        { label: 'Status' },
        { label: 'Commit...' },
        { label: 'Push' },
        { label: 'Pull' },
      ],
      onSelect: (index) => {
        if (index === 0) {
          wsService.send({ type: 'git_status_request', sessionId });
        }
        if (index === 1) {
          setPromptModal({ visible: true, title: 'Commit', placeholder: 'Commit message', onSubmit: (message) => {
            if (message.trim()) {
              wsService.send({ type: 'git_commit', sessionId, message: message.trim() });
            }
          }});
        }
        if (index === 2) {
          wsService.send({ type: 'git_push', sessionId });
        }
        if (index === 3) {
          wsService.send({ type: 'git_pull', sessionId });
        }
      },
    });
  }

  const running = isRunning(agentStatus);
  const statusColor = STATUS_COLORS[agentStatus] ?? '#a8a29e';
  const sendDisabled = !input.trim();

  function renderGroupedItem({ item }: { item: GroupedItem }) {
    if (item.type === 'burst') {
      return (
        <ToolBurstRenderer
          burst={item}
          colors={c}
          isExpanded={expandedBursts.has(item.id)}
          onToggle={() => toggleBurst(item.id)}
        />
      );
    }
    return <MessageBubble msg={item.msg} colors={c} onLongPress={() => showMessageActions(item.msg)} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.headerOverlay}>
        <BlurView
          tint={c.isDark ? 'dark' : 'light'}
          intensity={60}
          style={styles.headerBlur}
        >
          <View style={{ height: insets.top }} />
          <View style={styles.headerContent}>
            <View style={[styles.statusDotOuter, { borderColor: statusColor }]}>
              {running && (
                <View style={[styles.statusDotPulse, { backgroundColor: statusColor }]} />
              )}
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            </View>
            <View style={styles.headerTitles}>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
                {projectPath ? projectPath.split('/').pop() : sessionId?.slice(0, 8)}
              </Text>
              <Text style={[styles.headerSubtitle, { color: c.textTertiary }]} numberOfLines={1}>
                {agentStatus.replace('_', ' ')}{gitStatus ? ` \u2022 ${gitStatus.split('\n').length} changed` : ''}
              </Text>
            </View>
            <View style={styles.spacer} />
            <Pressable
              ref={gitActionsBtnRef}
              onPress={openGitActionsMenu}
              style={styles.headerAction}
              hitSlop={4}
            >
              <Ionicons name="git-branch-outline" size={16} color={c.textTertiary} />
            </Pressable>
            <Pressable
              onPress={() => router.push(`/terminal/${sessionId}`)}
              style={styles.headerAction}
              hitSlop={4}
            >
              <Ionicons name="terminal-outline" size={18} color={c.textTertiary} />
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={[styles.headerAction, { marginLeft: 2 }]}
              hitSlop={4}
            >
              <Ionicons name="chevron-down" size={20} color={c.textTertiary} />
            </Pressable>
          </View>
        </BlurView>
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyIcon, { color: c.textTertiary }]}>{'\u{1F4AC}'}</Text>
          <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
            Start a conversation
          </Text>
          <Text style={[styles.emptySub, { color: c.textTertiary }]}>
            Type a message below to interact with the agent
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            ref={flatRef}
            data={groupedData}
            keyExtractor={(item) => (item.type === 'message' ? item.msg.id : item.id)}
            contentContainerStyle={[
              styles.messageList,
              { paddingTop: insets.top + HEADER_HEIGHT },
            ]}
            renderItem={renderGroupedItem}
            onScroll={handleScroll}
            scrollEventThrottle={64}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            ListHeaderComponent={
              hasMore ? (
                <Pressable style={styles.loadEarlierBtn} onPress={loadEarlier}>
                  <Ionicons name="chevron-up" size={14} color={c.textTertiary} />
                  <Text style={[styles.loadEarlierText, { color: c.textTertiary }]}>
                    Load earlier messages
                  </Text>
                </Pressable>
              ) : null
            }
          />
          {!isNearBottom && (
            <Pressable
              style={[styles.scrollToBottomBtn, { bottom: insets.bottom + 140 }]}
              onPress={scrollToBottom}
              hitSlop={4}
            >
              <Ionicons name="chevron-down" size={16} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {waitingApproval && (
        <View style={[styles.approvalBanner, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[styles.approvalTitle, { color: c.textPrimary }]}>
            {'\uD83D\uDEE1'} Approval Required
          </Text>
          {approvalDetail && (
            <View style={styles.approvalDetailContainer}>
              {approvalDetail.toolName ? (
                <Text style={[styles.approvalTool, { color: c.textSecondary }]}>
                  {approvalDetail.toolName}
                </Text>
              ) : null}
              {approvalDetail.detail ? (
                <Text style={[styles.approvalDetailText, { color: c.textTertiary }]} numberOfLines={3}>
                  {approvalDetail.detail}
                </Text>
              ) : null}
            </View>
          )}
          <View style={styles.approvalButtons}>
            <Pressable
              style={[styles.approvalBtn, { backgroundColor: '#22c55e' }]}
              onPress={approveAction}
              hitSlop={4}
            >
              <Text style={styles.approvalBtnText}>{'\u2713'} Approve</Text>
            </Pressable>
            <Pressable
              style={[styles.approvalBtn, { backgroundColor: '#ef4444' }]}
              onPress={rejectAction}
              hitSlop={4}
            >
              <Text style={styles.approvalBtnText}>{'\u2717'} Reject</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={[styles.composerWrapper, { paddingBottom: insets.bottom }]}>
        <View
          style={[
            styles.composerCard,
            {
              backgroundColor: c.isDark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)',
              borderColor: c.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          <BlurView
            tint={c.isDark ? 'dark' : 'light'}
            intensity={40}
            style={StyleSheet.absoluteFillObject}
          />

          {planMode && (
            <View style={[styles.planBadge, { backgroundColor: c.isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.1)' }]}>
              <Ionicons name="list-outline" size={11} color="#ff9500" />
              <Text style={styles.planBadgeText}>Plan</Text>
            </View>
          )}

          <View style={styles.composerInputRow}>
            <TextInput
              style={[styles.composerInput, { color: c.textPrimary }]}
              value={input}
              onChangeText={setInput}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={running ? sendSteer : sendChat}
              returnKeyType="send"
              placeholder={running ? 'Steer the agent...' : 'Ask anything...'}
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
          </View>

          <View style={styles.bottomBar}>
            <Pressable
              ref={attachBtnRef}
              style={styles.metaButton}
              hitSlop={4}
              accessibilityLabel="Attach"
              onPress={openAttachmentMenu}
            >
              <Ionicons name="add" size={18} color={c.textTertiary} />
            </Pressable>

            <Pressable
              ref={modelBtnRef}
              style={styles.modelButton}
              hitSlop={4}
              accessibilityLabel="Select model"
              onPress={async () => {
                wsService.send({ type: 'model_list_request', sessionId });
                const anchor = await measureAnchor(modelBtnRef);
                setMenu({
                  title: 'Model',
                  anchor,
                  options: models.map((m) => ({
                    label: shortModelName(m),
                    selected: m === selectedModel,
                  })),
                  onSelect: (index) => {
                    setSelectedModel(models[index]);
                    wsService.send({ type: 'model_select', sessionId, model: models[index] });
                  },
                });
              }}
            >
              {serviceTier === 'fast' && (
                <Ionicons name="flash" size={10} color="#ff9500" style={{ marginRight: 2 }} />
              )}
              <Text style={[styles.modelLabel, { color: c.textTertiary }]}>
                {shortModelName(selectedModel)}
              </Text>
              <Ionicons name="chevron-down" size={10} color={c.textTertiary} style={{ marginLeft: 2 }} />
            </Pressable>

            <Pressable
              ref={reasoningBtnRef}
              style={styles.metaButton}
              hitSlop={4}
              accessibilityLabel="Reasoning effort"
              onPress={openReasoningMenu}
            >
              <View style={styles.reasoningButtonInner}>
                <Ionicons name="bulb-outline" size={16} color={thinkingMode === 'level' ? '#ff9500' : c.textTertiary} />
                {thinkingMode === 'level' && (
                  <Text style={[styles.reasoningBadge, { color: '#ff9500' }]}>
                    {THINKING_LEVEL_SHORT[thinkingLevel]}
                  </Text>
                )}
              </View>
            </Pressable>

            <View style={styles.spacer} />

            <Pressable
              style={styles.metaButton}
              hitSlop={4}
              accessibilityLabel="Voice input"
              onPress={() => {}}
            >
              <Ionicons name="mic-outline" size={18} color={c.textTertiary} />
            </Pressable>

            {running && (
              <Pressable
                onPress={cancelTurn}
                style={styles.stopButton}
                hitSlop={4}
                accessibilityLabel="Stop"
              >
                <Ionicons name="stop" size={12} color="#fff" />
              </Pressable>
            )}

            <Pressable
              onPress={running ? sendSteer : sendChat}
              style={[
                styles.sendButton,
                {
                  backgroundColor: sendDisabled
                    ? c.isDark ? '#3a3a3c' : '#d1d1d6'
                    : c.isDark ? '#e8e8e8' : '#1c1917',
                },
              ]}
              disabled={sendDisabled}
              hitSlop={4}
              accessibilityLabel="Send"
            >
              <Ionicons
                name="arrow-up"
                size={14}
                color={sendDisabled ? (c.isDark ? '#636366' : '#aeaeb2') : (c.isDark ? '#1c1917' : '#fff')}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.secondaryBar}>
            <Pressable ref={runtimeBtnRef} style={styles.secondaryPill} hitSlop={4} onPress={openRuntimePicker}>
              <Ionicons name={runtimeMode === 'cloud' ? 'cloud-outline' : 'laptop-outline'} size={13} color={c.textTertiary} />
              <Text style={[styles.secondaryLabel, { color: c.textTertiary }]}>
                {runtimeMode === 'cloud' ? 'Cloud' : 'Local'}
              </Text>
              <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
            </Pressable>

            <Pressable ref={accessBtnRef} style={styles.secondaryPill} hitSlop={4} onPress={openAccessModeMenu}>
              <Ionicons
                name={accessMode === 'full-access' ? 'shield-outline' : 'shield-checkmark-outline'}
                size={13}
                color={c.textTertiary}
              />
              <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
            </Pressable>

            <View style={styles.spacer} />

            <Pressable ref={branchBtnRef} style={styles.secondaryPill} hitSlop={4} onPress={openGitBranchMenu}>
              <Ionicons name="git-branch-outline" size={13} color={c.textTertiary} />
              <Text style={[styles.secondaryLabel, { color: c.textTertiary }]}>
                {currentBranch}
              </Text>
              <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
            </Pressable>

            {contextFraction > 0 && (
              <ContextProgressRing fraction={contextFraction} color={c.textTertiary} />
            )}
          </View>
      </View>

      {promptModal?.visible && (
        <Modal transparent animationType="fade" onRequestClose={() => setPromptModal(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setPromptModal(null)}>
            <Pressable style={[styles.promptSheet, { backgroundColor: c.bg }]} onPress={() => {}}>
              <Text style={[styles.promptTitle, { color: c.textPrimary }]}>{promptModal.title}</Text>
              <TextInput
                autoFocus
                style={[styles.promptInput, { color: c.textPrimary, borderColor: c.subtle }]}
                placeholder={promptModal.placeholder}
                placeholderTextColor={c.textTertiary}
                onSubmitEditing={(e) => {
                  const text = e.nativeEvent.text;
                  if (text.trim()) {
                    promptModal.onSubmit(text.trim());
                    setPromptModal(null);
                  }
                }}
                returnKeyType="done"
              />
              <View style={styles.promptActions}>
                <Pressable onPress={() => setPromptModal(null)} style={styles.promptCancelBtn}>
                  <Text style={{ color: c.textTertiary, fontSize: 14 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setPromptModal(null);
                  }}
                  style={[styles.promptDoneBtn, { backgroundColor: c.isDark ? '#e8e8e8' : '#1c1917' }]}
                >
                  <Text style={[styles.promptDoneText, { color: c.isDark ? '#1c1917' : '#fff' }]}>Done</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {errorToast && (
        <View style={[styles.errorToast, { backgroundColor: '#F04545' }]}>
          <Text style={styles.errorToastText}>{errorToast}</Text>
        </View>
      )}

      <PopoverMenu
        visible={!!menu}
        title={menu?.title}
        options={menu?.options ?? []}
        anchor={menu?.anchor}
        colors={c}
        onSelect={(i) => {
          menu?.onSelect(i);
          setMenu(null);
        }}
        onClose={() => setMenu(null)}
      />
    </KeyboardAvoidingView>
  );
}

function ToolBurstRenderer({
  burst,
  colors: c,
  isExpanded,
  onToggle,
}: {
  burst: { type: 'burst'; id: string; messages: ChatMessage[]; turnId: string };
  colors: ThemeColors;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const visible = isExpanded ? burst.messages : burst.messages.slice(0, 5);
  const hiddenCount = burst.messages.length - visible.length;

  return (
    <View style={burstStyles.container}>
      <ToolBurstGroup
        colors={c}
        hiddenCount={hiddenCount}
        isExpanded={isExpanded}
        onToggle={onToggle}
      >
        {visible.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} colors={c} />
        ))}
      </ToolBurstGroup>
      <TurnEndActions messages={burst.messages} colors={c} />
    </View>
  );
}

function TurnEndActions({
  messages,
  colors: c,
}: {
  messages: ChatMessage[];
  colors: ThemeColors;
}) {
  const fileChanges = messages.filter((m) => m.kind === 'fileChange');
  if (fileChanges.length === 0) return null;

  return (
    <View style={turnEndStyles.container}>
      <Pressable
        style={[turnEndStyles.pill, { backgroundColor: c.subtle }]}
        onPress={() => {
          const summary = fileChanges
            .map((m) => m.content)
            .join('\n');
          Clipboard.setString(summary);
        }}
        hitSlop={4}
      >
        <Ionicons name="document-text-outline" size={12} color={c.textTertiary} />
        <Text style={[turnEndStyles.label, { color: c.textTertiary }]}>
          {fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''}
        </Text>
      </Pressable>
      <Pressable
        style={[turnEndStyles.pill, { backgroundColor: c.subtle }]}
        onPress={() => {
          if (fileChanges[0]?.meta?.diff) {
            Clipboard.setString(fileChanges[0].meta.diff as string);
          }
        }}
        hitSlop={4}
      >
        <Ionicons name="swap-horizontal-outline" size={12} color={c.textTertiary} />
        <Text style={[turnEndStyles.label, { color: c.textTertiary }]}>Diff</Text>
      </Pressable>
    </View>
  );
}

function MessageBubble({
  msg,
  colors: c,
  onLongPress,
}: {
  msg: ChatMessage;
  colors: ThemeColors;
  onLongPress?: () => void;
}) {
  if (msg.role === 'user') {
    const isLong = msg.content.length > 360 || (msg.content.match(/\n/g) ?? []).length > 8;
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: '#3b82f6' }]}>
            <Text style={styles.userText} numberOfLines={isLong && !msg.isCollapsed ? 6 : undefined}>
              {msg.content}
            </Text>
            {isLong && (
              <Text style={styles.userCollapseHint}>
                {msg.isCollapsed ? 'Show more' : ''}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  if (msg.role === 'assistant') {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.assistantRow}>
          <View
            style={[styles.assistantBubble, { backgroundColor: c.card, borderColor: c.cardBorder }]}
          >
            <MarkdownText content={msg.content} colors={c} isStreaming={msg.isStreaming} />
            {msg.isStreaming && <TypingIndicator colors={c} />}
          </View>
        </View>
      </Pressable>
    );
  }

  if (msg.kind === 'thinking') {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.systemRow}>
          <ThinkingBlock content={msg.content} colors={c} isStreaming={msg.isStreaming} />
        </View>
      </Pressable>
    );
  }

  if (msg.kind === 'toolActivity') {
    const toolName = (msg.meta?.tool as string) ?? msg.content.replace(/^\uD83D\uDD27\s*/, '').split(' ')[0];
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.systemRow}>
          <ToolCallCard
            toolName={toolName}
            args={msg.meta as Record<string, unknown>}
            output={(msg.meta?.output as string) ?? undefined}
            colors={c}
          />
        </View>
      </Pressable>
    );
  }

  if (msg.kind === 'subagentAction') {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.systemRow}>
          <SubagentActionCard
            name={msg.meta?.name as string | undefined}
            model={msg.meta?.model as string | undefined}
            action={msg.meta?.action as string}
            content={msg.content}
            status={msg.meta?.status as string | undefined}
            colors={c}
          />
        </View>
      </Pressable>
    );
  }

  if (msg.kind === 'fileChange') {
    if (msg.eventType === 'diff' && msg.meta?.diff) {
      return (
        <Pressable onLongPress={onLongPress} delayLongPress={300}>
          <View style={styles.systemRow}>
            <DiffRenderer diff={msg.meta.diff as string} colors={c} maxLines={20} />
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.systemRow}>
          <FileChangeRow
            path={(msg.meta?.path as string) ?? msg.content.split(' ').slice(-1)[0] ?? ''}
            changeType={(msg.meta?.changeType as 'create' | 'modify' | 'delete') ?? 'modify'}
            diff={(msg.meta?.diff as string) ?? undefined}
            colors={c}
          />
        </View>
      </Pressable>
    );
  }

  if (msg.kind === 'commandExecution') {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <CommandExecCard
          command={(msg.meta?.command as string) ?? ''}
          output={(msg.meta?.output as string) ?? undefined}
          exitCode={msg.meta?.exitCode as number | undefined}
          isStreaming={msg.meta?.isStreaming as boolean | undefined}
          colors={c}
        />
      </Pressable>
    );
  }

  if (msg.kind === 'plan') {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.systemRow}>
          <PlanCard
            explanation={msg.content || undefined}
            steps={msg.meta?.steps as Array<{ step: string; status: string }> | undefined}
            presentation={(msg.meta?.presentation as string) ?? 'progress'}
            colors={c}
          />
        </View>
      </Pressable>
    );
  }

  const isError = msg.kind === 'error';
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300}>
      <View style={styles.systemRow}>
        <View style={[styles.systemBubble, isError ? styles.errorBubble : { backgroundColor: c.subtle }]}>
          <Text style={[styles.systemText, isError ? styles.errorText : { color: c.textTertiary }]}>
            {isError ? `\u26A0\uFE0F ${msg.content}` : msg.content}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const burstStyles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
});

const turnEndStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },

  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  headerBlur: {
    overflow: 'hidden',
  },
  headerContent: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  headerTitles: {
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  headerSubtitle: {
    fontSize: 10,
    marginTop: 0,
  },
  headerAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusDotOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    opacity: 0.3,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  listContainer: {
    flex: 1,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(60,60,67,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  loadEarlierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  loadEarlierText: {
    fontSize: 13,
    fontWeight: '500',
  },

  messageList: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    gap: 8,
  },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    borderCurve: 'continuous',
  },
  userText: { fontSize: 14, color: '#fff', lineHeight: 19 },
  userCollapseHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  assistantRow: { alignItems: 'flex-start' },
  assistantBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  assistantText: { fontSize: 14, lineHeight: 19 },
  systemRow: { alignItems: 'center' },
  systemBubble: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  systemText: { fontSize: 11, fontWeight: '500' },

  composerWrapper: {
    paddingHorizontal: 10,
    paddingTop: 6,
  },

  composerCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },

  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  planBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ff9500',
  },

  composerInputRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  composerInput: {
    fontSize: 15,
    minHeight: 36,
    maxHeight: 120,
    lineHeight: 20,
    padding: 0,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
    gap: 8,
  },

  metaButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    paddingRight: 2,
  },
  modelLabel: {
    fontSize: 13,
    fontWeight: '400',
  },
  reasoningButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reasoningBadge: {
    fontSize: 9,
    fontWeight: '600',
  },
  stopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 2,
    gap: 6,
  },
  secondaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 4,
  },
  secondaryLabel: {
    fontSize: 12,
    fontWeight: '400',
  },

  spacer: { flex: 1 },

  errorBubble: { backgroundColor: 'rgba(239,68,68,0.1)' },
  errorText: { color: '#ef4444', fontSize: 11, fontWeight: '500' },

  approvalBanner: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    gap: 10,
    zIndex: 20,
  },
  approvalTitle: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  approvalDetailContainer: {
    width: '100%',
    gap: 4,
  },
  approvalTool: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  approvalDetailText: {
    fontSize: 12,
    lineHeight: 16,
  },
  approvalButtons: { flexDirection: 'row', gap: 12 },
  approvalBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  approvalBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  promptSheet: {
    width: '85%',
    maxWidth: 340,
    borderRadius: 14,
    padding: 20,
    gap: 16,
  },
  promptTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  promptInput: {
    fontSize: 15,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  promptCancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  promptDoneBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8 },
  promptDoneText: { fontSize: 14, fontWeight: '600' },
  errorToast: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    zIndex: 100,
  },
  errorToastText: { color: '#fff', fontSize: 13, fontWeight: '500' },
});
