import {
  StyleSheet,
  Platform,
  TextInput,
  FlatList,
  Pressable,
  View,
  Text,
  Modal,
  ActionSheetIOS,
  Alert,
  Clipboard,
  Keyboard,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Ionicons from '@react-native-vector-icons/ionicons';
import { wsService } from '../../src/services/websocket';
import { useChatStore, type ChatMessage } from '../../src/stores/chat';
import { apiFetch } from '../../src/services/api';
import { FontFamily, STATUS_COLORS, Typography, Spacing, Colors, CornerRadius, Glass, Shadows } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import {
  ComposerSettingsSheet,
  type ThinkingMode,
  type ThinkingLevel,
  type ServiceTier,
  type AccessMode,
} from '../../src/components/ComposerSettingsSheet';
import {
  AgentQuestionCard,
  type QuestionItem,
  type PermissionItem,
} from '../../src/components/AgentQuestionCard';
import { AgentInputAutocomplete } from '../../src/components/AgentInputAutocomplete';
import { AllFilesDiffView } from '../../src/components/AllFilesDiffView';
import type { SessionOwnershipMessage } from '@baton/shared';
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

/** Empty-state quick starts — 'review' opens the real diff viewer, 'prompt' prefills. */
const EMPTY_SUGGESTIONS: Array<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  action: 'prompt' | 'review';
}> = [
  { icon: 'git-compare-outline', text: 'Review all changed files', action: 'review' },
  { icon: 'flask-outline', text: 'Run tests and fix the failures', action: 'prompt' },
  { icon: 'cube-outline', text: "Explain this project's architecture", action: 'prompt' },
];

const isRunning = (s: string) => s === 'running' || s === 'thinking' || s === 'executing';

/** Fire-and-forget tactile ticks — iOS-style, never block the interaction. */
const tapLight = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const tapMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

const HEADER_HEIGHT = 44;

/**
 * System chrome material — the same recipe as the floating tab bar, so the
 * nav-bar button group, composer, scroll pill and banners all read as one
 * continuous layer of iOS 26 glass over the transcript.
 */
function GlassCapsule({
  c,
  radius = 999,
  intensity,
  style,
  contentStyle,
  children,
}: {
  c: ThemeColors;
  radius?: number;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        {
          borderRadius: radius,
          shadowColor: '#08090a',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: c.isDark ? 0.12 : 0.06,
          shadowRadius: 6,
          elevation: 4,
        },
        style,
      ]}
    >
      <BlurView
        tint={c.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={intensity ?? Glass.blur.tabBar}
        style={{ borderRadius: radius, overflow: 'hidden' }}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: c.isDark ? 'rgba(25,26,29,0.96)' : 'rgba(252,253,254,0.94)',
              borderRadius: radius,
            },
          ]}
          pointerEvents="none"
        />
        {/* Specular rim — brightest at top, uniform hairline in RN. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.62)',
            },
          ]}
          pointerEvents="none"
        />
        <View style={contentStyle}>{children}</View>
      </BlurView>
    </View>
  );
}

/** Breathing halo behind the running status dot — iOS-style live indicator. */
function PulsingDot({ color }: { color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.35 * opacity.value }));
  return (
    <Animated.View style={[styles.statusDotPulse, { backgroundColor: color }, haloStyle]} />
  );
}


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
      {
        title,
        options,
        cancelButtonIndex,
        destructiveButtonIndex: destructiveIndex ?? -1,
        message,
      },
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

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const messages = useChatStore((s) => s.messages);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const running = isRunning(agentStatus);
  const waitingApproval = useChatStore((s) => s.waitingApproval);
  const activePrompt = useChatStore((s) => s.activePrompt);
  const activePermission = useChatStore((s) => s.activePermission);
  const promptQueue = useChatStore((s) => s.promptQueue);
  const enqueuePrompt = useChatStore((s) => s.enqueuePrompt);
  const dequeuePrompt = useChatStore((s) => s.dequeuePrompt);
  const removeQueuedPrompt = useChatStore((s) => s.removeQueuedPrompt);
  const clearQueue = useChatStore((s) => s.clearQueue);
  const addEvent = useChatStore((s) => s.addEvent);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const setStatus = useChatStore((s) => s.setStatus);
  const setWaitingApproval = useChatStore((s) => s.setWaitingApproval);
  const clear = useChatStore((s) => s.clear);
  const sessionOwner = useChatStore((s) => s.sessionOwner);
  const setSessionOwner = useChatStore((s) => s.setSessionOwner);
  const [showDiffReview, setShowDiffReview] = useState(false);
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const autocomplete = useMemo<{
    type: 'file' | 'command';
    query: string;
  } | null>(() => {
    if (!inputFocused && !input) return null;
    const fileMatch = input.match(/@([a-zA-Z0-9_\-./\\]*)$/);
    if (fileMatch) {
      return { type: 'file', query: fileMatch[1] };
    }
    const cmdMatch = input.match(/^\/([a-zA-Z0-9_\-]*)$/);
    if (cmdMatch) {
      return { type: 'command', query: cmdMatch[1] };
    }
    return null;
  }, [input, inputFocused]);

  const handleAutocompleteSelect = useCallback(
    (replacement: string, action?: string) => {
      if (action === 'review') {
        setInput('');
        setShowDiffReview(true);
        return;
      }
      if (autocomplete?.type === 'file') {
        const next = input.replace(/@([a-zA-Z0-9_\-./\\]*)$/, replacement);
        setInput(next);
      } else if (autocomplete?.type === 'command') {
        setInput(`${replacement} `);
      }
    },
    [autocomplete, input],
  );

  const toggleSessionControl = useCallback(() => {
    if (!sessionId) return;
    if (sessionOwner === 'remote') {
      showActionSheet(
        'Device Control',
        ['Yield Control to Desktop', 'Cancel'],
        1,
        (idx) => {
          if (idx === 0) {
            wsService.send({ type: 'control', action: 'release_session', sessionId });
            setSessionOwner('local');
          }
        },
      );
    } else {
      wsService.send({ type: 'control', action: 'claim_session', sessionId });
      setSessionOwner('remote');
    }
  }, [sessionId, sessionOwner, setSessionOwner]);

  const [models, setModels] = useState<string[]>([]);
  /** Models from the user's configured API Providers (Settings > API
   * Providers), merged ahead of the adapter's built-in list so custom models
   * are selectable. Empty when no providers configured. */
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('level');
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium');
  const [serviceTier, setServiceTier] = useState<ServiceTier>('default');
  const [accessMode, setAccessMode] = useState<AccessMode>('on-request');
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [contextFraction, setContextFraction] = useState(0);
  const [projectPath, setProjectPath] = useState('');
  const [gitStatus, setGitStatus] = useState('');
  const [gitDiff, setGitDiff] = useState('');
  const [approvalDetail, setApprovalDetail] = useState<{ toolName: string; detail: string } | null>(
    null,
  );
  const [tokenUsage, setTokenUsage] = useState<{
    prompt: number;
    completion: number;
    total: number;
  } | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(new Set());
  const [promptModal, setPromptModal] = useState<{
    visible: boolean;
    title: string;
    placeholder: string;
    onSubmit: (text: string) => void;
  } | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState<{
    title?: string;
    options: MenuOption[];
    onSelect: (i: number) => void;
    anchor?: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const flatRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const moreBtnRef = useRef<React.ElementRef<typeof Pressable>>(null);
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
    wsService.attachOrResume(sessionId);
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
            setApprovalDetail({
              toolName: String(meta.toolName ?? ''),
              detail: String(meta.detail ?? ''),
            });
          }
        }
        if (msg.event.type === 'token_usage') {
          const te = msg.event as {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          };
          setTokenUsage({
            prompt: te.promptTokens,
            completion: te.completionTokens,
            total: te.totalTokens,
          });
        }
      }
    });

    // Replay the session's event history on attach — without this a fresh
    // attach (new device, app restart) renders an empty conversation.
    const unsubEventHistory = wsService.on('event_history', (msg) => {
      if (msg.type === 'event_history' && msg.sessionId === sessionId) {
        for (const event of msg.events) {
          addEvent(event);
        }
      }
    });

    // Dev hydration: the daemon's WS replay doesn't cover SDK sessions, so
    // under the dev auto-connect env pull the event log over HTTP once.
    if (process.env.EXPO_PUBLIC_DEV_AUTOCONNECT) {
      apiFetch<unknown[]>(`/api/agents/${sessionId}/events`)
        .then((events) => {
          for (const event of events) {
            addEvent(event as Parameters<typeof addEvent>[0]);
          }
        })
        .catch(() => {});
    }

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

    const unsubOwnership = wsService.on('session_ownership', (msg) => {
      const m = msg as SessionOwnershipMessage;
      if (m.sessionId === sessionId) {
        setSessionOwner(m.owner);
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

    // Fetch user-configured API provider models so the model picker can offer
    // them (not just the agent adapter's built-in defaults).
    apiFetch<Array<{ enabled?: boolean; models?: string[] }>>('/api/api-providers')
      .then((providers) => {
        const enabled = providers
          .filter((p) => p.enabled !== false)
          .flatMap((p) => p.models ?? [])
          .filter(Boolean);
        setProviderModels(enabled);
      })
      .catch(() => {
        // offline or none configured — fall back to adapter models only
      });

    return () => {
      unsubEvent();
      unsubEventHistory();
      unsubStatus();
      unsubState();
      unsubModels();
      unsubGitBranches();
      unsubGitStatus();
      unsubGitResult();
      unsubOwnership();
    };
  }, [sessionId, addEvent, setStatus, setSessionOwner, clear, attachSession]);

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

  // Jump-to-latest pill fades/slides in the native way instead of popping.
  const scrollBtnProgress = useSharedValue(0);
  useEffect(() => {
    scrollBtnProgress.value = withTiming(isNearBottom ? 0 : 1, { duration: Glass.morph.fast });
  }, [isNearBottom, scrollBtnProgress]);
  const scrollBtnStyle = useAnimatedStyle(() => ({
    opacity: scrollBtnProgress.value,
    transform: [{ translateY: interpolate(scrollBtnProgress.value, [0, 1], [8, 0]) }],
  }));

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
        msg.kind === 'toolActivity' || msg.kind === 'fileChange' || msg.kind === 'commandExecution';
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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
    if (msg.role === 'user') options.push('Edit Message');
    options.push('Cancel');
    showActionSheet('Actions', options, options.length - 1, (index) => {
      if (index === 0) {
        Clipboard.setString(msg.content);
      }
      if (index === 1 && msg.role === 'user') {
        setInput(msg.content);
        inputRef.current?.focus();
      }
    });
  }

  function sendChat() {
    if (!input.trim() || !sessionId) return;
    tapLight();
    if (input.trim() === '/review') {
      setInput('');
      setShowDiffReview(true);
      return;
    }
    if (sessionOwner !== 'remote') {
      wsService.send({ type: 'control', action: 'claim_session', sessionId });
      setSessionOwner('remote');
    }
    addUserMessage(input.trim());
    sendThinkingConfig(thinkingMode, thinkingLevel);
    if (serviceTier !== 'default') {
      wsService.send({ type: 'service_tier_select', sessionId, tier: serviceTier });
    }
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    wsService.send({
      type: 'chat_input',
      sessionId,
      content: input.trim(),
      model: selectedModel ?? undefined,
      messageId,
    });
    setInput('');
  }

  function sendSteer() {
    if (!input.trim() || !sessionId) return;
    tapLight();
    addUserMessage(input.trim());
    wsService.send({ type: 'steer_input', sessionId, content: input.trim() });
    setInput('');
  }

  function cancelTurn() {
    if (!sessionId) return;
    tapMedium();
    wsService.send({ type: 'cancel_turn', sessionId });
  }

  function approveAction(requestId?: string) {
    if (!sessionId) return;
    tapLight();
    const reqId = requestId ?? activePermission?.requestId;
    if (reqId) {
      wsService.send({
        type: 'control',
        action: 'permission_response',
        sessionId,
        payload: { requestId: reqId, approved: true },
      });
    }
    wsService.send({ type: 'approve_input', sessionId });
    setWaitingApproval(false);
    useChatStore.getState().setActivePermission(null);
    setApprovalDetail(null);
  }

  function rejectAction(requestId?: string) {
    if (!sessionId) return;
    tapMedium();
    const reqId = requestId ?? activePermission?.requestId;
    if (reqId) {
      wsService.send({
        type: 'control',
        action: 'permission_response',
        sessionId,
        payload: { requestId: reqId, approved: false },
      });
    }
    wsService.send({ type: 'reject_input', sessionId });
    setWaitingApproval(false);
    useChatStore.getState().setActivePermission(null);
    setApprovalDetail(null);
  }

  function answerQuestion(answerText: string) {
    if (!sessionId || !answerText.trim()) return;
    addUserMessage(answerText.trim());
    wsService.send({
      type: 'chat_input',
      sessionId,
      content: answerText.trim(),
      model: selectedModel ?? undefined,
    });
    useChatStore.getState().setActivePrompt(null);
  }

  function sendQueuedPrompt(promptText: string) {
    if (!promptText.trim() || !sessionId) return;
    addUserMessage(promptText.trim());
    sendThinkingConfig(thinkingMode, thinkingLevel);
    if (serviceTier !== 'default') {
      wsService.send({ type: 'service_tier_select', sessionId, tier: serviceTier });
    }
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    wsService.send({
      type: 'chat_input',
      sessionId,
      content: promptText.trim(),
      model: selectedModel ?? undefined,
      messageId,
    });
  }

  // Feature 2: Continuous Prompt Queue auto-dispatch effect
  useEffect(() => {
    if (!running && (agentStatus === 'idle' || agentStatus === 'unknown') && promptQueue.length > 0) {
      const nextPrompt = dequeuePrompt();
      if (nextPrompt) {
        sendQueuedPrompt(nextPrompt);
      }
    }
  }, [running, agentStatus, promptQueue]);

  function sendThinkingConfig(mode: ThinkingMode, level?: ThinkingLevel) {
    if (!sessionId) return;
    wsService.send({
      type: 'thinking_config_select',
      sessionId,
      config:
        mode === 'none'
          ? { mode: 'none' }
          : mode === 'auto'
            ? { mode: 'auto' }
            : { mode: 'level', level: level ?? 'medium' },
    });
  }

  async function openGitBranchMenu() {
    const anchor = await measureAnchor(moreBtnRef);
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
          setPromptModal({
            visible: true,
            title: 'Create Branch',
            placeholder: 'Branch name',
            onSubmit: (name) => {
              if (name.trim()) {
                wsService.send({ type: 'git_create_branch', sessionId, name: name.trim() });
              }
            },
          });
          return;
        }
        if (index < displayBranches.length && displayBranches[index] !== currentBranch) {
          setCurrentBranch(displayBranches[index]);
          wsService.send({ type: 'git_branch_select', sessionId, branch: displayBranches[index] });
        }
      },
    });
  }

  async function openMoreMenu() {
    const anchor = await measureAnchor(moreBtnRef);
    setMenu({
      title: 'Session',
      anchor,
      options: [
        { label: 'Terminal' },
        { separator: true },
        { label: 'Review All Changes' },
        { label: 'Commit...' },
        { label: 'Push' },
        { label: 'Pull' },
        { label: 'Status' },
        { label: 'Switch Branch...' },
        { separator: true },
        {
          label: sessionOwner === 'remote' ? 'Yield Control to Desktop' : 'Take Control',
          selected: sessionOwner === 'remote',
        },
      ],
      onSelect: (index) => {
        if (index === 0) {
          router.push(`/terminal/${sessionId}`);
        }
        if (index === 2) {
          setShowDiffReview(true);
        }
        if (index === 3) {
          setPromptModal({
            visible: true,
            title: 'Commit',
            placeholder: 'Commit message',
            onSubmit: (message) => {
              if (message.trim()) {
                wsService.send({ type: 'git_commit', sessionId, message: message.trim() });
              }
            },
          });
        }
        if (index === 4) {
          wsService.send({ type: 'git_push', sessionId });
        }
        if (index === 5) {
          wsService.send({ type: 'git_pull', sessionId });
        }
        if (index === 6) {
          wsService.send({ type: 'git_status_request', sessionId });
        }
        if (index === 7) {
          openGitBranchMenu();
        }
        if (index === 9) {
          if (sessionOwner === 'remote') {
            wsService.send({ type: 'control', action: 'release_session', sessionId });
            setSessionOwner('local');
          } else {
            toggleSessionControl();
          }
        }
      },
    });
  }

  const statusColor = STATUS_COLORS[agentStatus] ?? Colors.surface[400];
  const sendDisabled = !input.trim();
  const hasInput = !sendDisabled;
  /** Mini status badge on the ≡ tune button — current thinking mode. */
  const thinkingBadge =
    thinkingMode === 'none'
      ? 'Off'
      : thinkingMode === 'auto'
        ? 'Auto'
        : THINKING_LEVEL_SHORT[thinkingLevel];

  // Morph the composer action slot (send ↔ stop ↔ steer) the native way —
  // fires only on state boundaries, not per keystroke.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [running, hasInput]);

  function renderGroupedItem({ item, index }: { item: GroupedItem; index: number }) {
    if (item.type === 'burst') {
      const isStreaming = running && index === groupedData.length - 1;
      return (
        <ToolBurstRenderer
          burst={item}
          colors={c}
          isStreaming={isStreaming}
          isExpanded={expandedBursts.has(item.id)}
          onToggle={() => toggleBurst(item.id)}
          onReview={() => setShowDiffReview(true)}
        />
      );
    }
    return (
      <MessageBubble
        msg={item.msg}
        colors={c}
        onLongPress={() => showMessageActions(item.msg)}
        onAnswerQuestion={answerQuestion}
        onApprovePermission={() => approveAction(item.msg.meta?.requestId as string | undefined)}
        onRejectPermission={() => rejectAction(item.msg.meta?.requestId as string | undefined)}
      />
    );
  }

  // Keyboard tracking via RN Keyboard events driving a shared value (the
  // keyboardLayoutGuide equivalent): the animated bottom inset lives on the
  // *screen* container so every child in flow — transcript, docked cards,
  // queue, composer — hugs the keyboard frame in real time. (Padding on the
  // list wrapper alone would only shrink the list's own content box and
  // never lift its siblings.) Keyboard events replaced useAnimatedKeyboard:
  // same frame source, but its observer proved flaky on the new arch.
  // Android relies on window resize instead.
  const keyboardHeight = useSharedValue(0);
  useEffect(() => {
    const willShow = Keyboard.addListener('keyboardWillShow', (e) => {
      keyboardHeight.value = withTiming(e.endCoordinates.height, { duration: 260 });
    });
    const willHide = Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeight.value = withTiming(0, { duration: 220 });
    });
    return () => {
      willShow.remove();
      willHide.remove();
    };
  }, [keyboardHeight]);
  const screenKeyboardInset = useAnimatedStyle(() => ({
    paddingBottom: Platform.OS === 'ios' ? keyboardHeight.value : 0,
  }));
  // The keyboard frame already covers the home-indicator area — collapse the
  // safe-area padding as it rises so the field sits flush on the keyboard.
  const composerStyle = useAnimatedStyle(() => ({
    paddingHorizontal: Spacing.md + 2,
    paddingTop: Spacing.sm - 2,
    paddingBottom:
      Platform.OS === 'ios' ? Math.max(0, insets.bottom - keyboardHeight.value) : insets.bottom,
  }));

  return (
    <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenKeyboardInset]}>
      <View style={styles.headerOverlay}>
        <BlurView
          tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          intensity={Glass.blur.nav}
          style={styles.headerBlur}
        >
          <View style={{ height: insets.top }} />
          <View style={styles.headerContent}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.headerAction,
                styles.headerBack,
                {
                  opacity: pressed ? 0.55 : 1,
                  transform: [{ scale: pressed ? 0.9 : 1 }],
                },
              ]}
              hitSlop={4}
              accessibilityLabel="Back"
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={c.isDark ? Colors.primary[300] : Colors.primary[500]}
              />
            </Pressable>
            <Pressable
              onPress={() => setShowDiffReview(true)}
              style={({ pressed }) => [styles.headerTitles, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={styles.headerNameRow}>
                <View style={[styles.statusDotOuter, { borderColor: statusColor }]}>
                  {running && <PulsingDot color={statusColor} />}
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                </View>
                <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {projectPath ? projectPath.split('/').pop() : sessionId?.slice(0, 8)}
                </Text>
              </View>
              <Text style={[styles.headerSubtitle, { color: c.textTertiary }]} numberOfLines={1}>
                {currentBranch ? (
                  <Text style={styles.headerMono}>{currentBranch + '  \u2022  '}</Text>
                ) : null}
                {agentStatus.replace('_', ' ')}
                {contextFraction > 0.01
                  ? `  \u2022  ${Math.round(contextFraction * 100)}%`
                  : ''}
              </Text>
            </Pressable>

            {/* iOS 26 merged button group — one chrome capsule, hairline lenses. */}
            <GlassCapsule c={c} style={styles.headerGroup} contentStyle={styles.headerGroupContent}>
              {gitStatus.trim().length > 0 && (
                <>
                  <Pressable
                    onPress={() => setShowDiffReview(true)}
                    style={({ pressed }) => [
                      styles.headerGroupBtn,
                      {
                        opacity: pressed ? 0.55 : 1,
                        transform: [{ scale: pressed ? 0.9 : 1 }],
                      },
                    ]}
                    hitSlop={4}
                    accessibilityLabel="Review changes"
                  >
                    <Ionicons name="git-compare-outline" size={15} color={c.textSecondary} />
                    <Text style={[styles.headerGroupCount, { color: c.textSecondary }]}>
                      {gitStatus.split('\n').filter(Boolean).length}
                    </Text>
                  </Pressable>
                  <View
                    style={[
                      styles.groupDivider,
                      {
                        backgroundColor: c.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                      },
                    ]}
                  />
                </>
              )}
              <Pressable
                onPress={toggleSessionControl}
                style={({ pressed }) => [
                  styles.headerGroupBtn,
                  {
                    opacity: pressed ? 0.55 : 1,
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  },
                ]}
                hitSlop={4}
                accessibilityLabel={
                  sessionOwner === 'remote' ? 'Yield control to desktop' : 'Take control'
                }
              >
                <Ionicons
                  name={sessionOwner === 'remote' ? 'phone-portrait' : 'desktop-outline'}
                  size={15}
                  color={
                    sessionOwner === 'remote'
                      ? Colors.success[400]
                      : c.textSecondary
                  }
                />
              </Pressable>
              <View
                style={[
                  styles.groupDivider,
                  {
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                  },
                ]}
              />
              <Pressable
                ref={moreBtnRef}
                onPress={openMoreMenu}
                style={({ pressed }) => [
                  styles.headerGroupBtn,
                  {
                    opacity: pressed ? 0.55 : 1,
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  },
                ]}
                hitSlop={4}
                accessibilityLabel="More actions"
              >
                <Ionicons name="ellipsis-horizontal" size={15} color={c.textSecondary} />
              </Pressable>
            </GlassCapsule>
          </View>
          {/* Hairline under the glass nav — separates it from scrolling content. */}
          <View
            style={[
              styles.headerHairline,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.border
                  : Glass.opacity.light.border,
              },
            ]}
          />
        </BlurView>
      </View>

      <View style={styles.contentArea}>
        {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>What should we work on?</Text>
          <Text style={[styles.emptySub, { color: c.textTertiary }]}>
            Steer your coding agent from anywhere.
          </Text>
          <View style={styles.suggestionList}>
            {EMPTY_SUGGESTIONS.map((s) => (
              <Pressable
                key={s.text}
                onPress={() => {
                  if (s.action === 'review') {
                    setShowDiffReview(true);
                  } else {
                    setInput(s.text);
                    inputRef.current?.focus();
                  }
                }}
                style={({ pressed }) => [
                  styles.suggestionItem,
                  {
                    opacity: pressed ? 0.7 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}
              >
                <View style={[styles.suggestionIconWrap, { backgroundColor: c.accentBg }]}>
                  <Ionicons name={s.icon} size={13} color={Colors.primary[400]} />
                </View>
                <Text style={[styles.suggestionText, { color: c.textPrimary }]} numberOfLines={1}>
                  {s.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            ref={flatRef}
            data={groupedData}
            keyExtractor={(item) => (item.type === 'message' ? item.msg.id : item.id)}
            contentContainerStyle={[styles.messageList, { paddingTop: insets.top + HEADER_HEIGHT }]}
            renderItem={renderGroupedItem}
            extraData={[running, expandedBursts]}
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            ListHeaderComponent={
              hasMore ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.loadEarlierBtn,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={loadEarlier}
                >
                  <Ionicons name="chevron-up" size={14} color={c.textTertiary} />
                  <Text style={[styles.loadEarlierText, { color: c.textTertiary }]}>
                    Load earlier messages
                  </Text>
                </Pressable>
              ) : null
            }
          />
          <Animated.View
            style={[styles.scrollToBottomBtn, scrollBtnStyle, { bottom: insets.bottom + 140 }]}
            pointerEvents={isNearBottom ? 'none' : 'auto'}
          >
            <GlassCapsule c={c} style={styles.scrollToBottomGlass} contentStyle={styles.scrollPillContent}>
              <Pressable
                onPress={scrollToBottom}
                hitSlop={4}
                style={StyleSheet.absoluteFill}
                accessibilityLabel="Scroll to latest"
              >
                <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
              </Pressable>
            </GlassCapsule>
          </Animated.View>
        </View>
        )}
      </View>

      {(activePermission || waitingApproval) && (
        <Animated.View entering={FadeInDown.duration(Glass.morph.fast)} style={styles.dockedCardWrapper}>
          <AgentQuestionCard
            permission={
              activePermission ?? {
                requestId: 'legacy',
                tool: approvalDetail?.toolName ?? 'Action',
                action: approvalDetail?.detail ?? 'Command approval requested',
                description: approvalDetail?.detail ?? 'The agent needs your approval to proceed.',
              }
            }
            onApprove={() => approveAction(activePermission?.requestId)}
            onReject={() => rejectAction(activePermission?.requestId)}
            compact
          />
        </Animated.View>
      )}

      {activePrompt && activePrompt.questions?.length > 0 && (
        <Animated.View entering={FadeInDown.duration(Glass.morph.fast)} style={styles.dockedCardWrapper}>
          <AgentQuestionCard
            question={activePrompt.questions[0]}
            onAnswer={answerQuestion}
            compact
          />
        </Animated.View>
      )}

      {promptQueue.length > 0 && (
        <Animated.View entering={FadeInDown.duration(Glass.morph.fast)}>
          <GlassCapsule
            c={c}
            intensity={Glass.blur.card}
            style={styles.queueStrip}
            contentStyle={styles.queueStripContent}
          >
            <View style={styles.queueHeaderRow}>
              <View style={styles.queueTitleGroup}>
                <Ionicons name="time-outline" size={13} color={Colors.primary[400]} />
                <Text style={[styles.queueTag, { color: Colors.primary[400] }]}>Queued</Text>
                <Text style={[styles.queueCountText, { color: c.textTertiary }]}>
                  {promptQueue.length}
                </Text>
              </View>
              <Pressable
                onPress={clearQueue}
                hitSlop={6}
                style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              >
                <Text
                  style={[
                    Typography.caption2,
                    { color: c.isDark ? Colors.primary[300] : Colors.primary[500], fontWeight: '600' },
                  ]}
                >
                  Clear
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.queueChipsContainer}
            >
              {promptQueue.map((item, idx) => (
                <View
                  key={idx}
                  style={[styles.queueChip, { backgroundColor: c.subtle }]}
                >
                  <Text style={[styles.queueChipNum, { color: Colors.primary[500] }]}>#{idx + 1}</Text>
                  <Text style={[styles.queueChipText, { color: c.textPrimary }]} numberOfLines={1}>
                    {item}
                  </Text>
                  <Pressable
                    onPress={() => removeQueuedPrompt(idx)}
                    hitSlop={6}
                    style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                  >
                    <Ionicons name="close-circle" size={14} color={c.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </GlassCapsule>
        </Animated.View>
      )}

      <Animated.View style={composerStyle}>
        {autocomplete && (
          <AgentInputAutocomplete
            type={autocomplete.type}
            query={autocomplete.query}
            projectPath={projectPath}
            colors={c}
            onSelect={handleAutocompleteSelect}
            onClose={() => setInputFocused(false)}
          />
        )}

        {/* Messages-grade glass capsule: tune · input · send/stop/steer. */}
        <GlassCapsule c={c} style={styles.composerCapsule} contentStyle={styles.composerContent}>
          <Pressable
            onPress={() => {
              wsService.send({ type: 'model_list_request', sessionId });
              setSettingsOpen(true);
            }}
            style={({ pressed }) => [
              styles.tuneButton,
              {
                backgroundColor: c.isDark
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(60,60,67,0.07)',
                borderColor:
                  c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              },
            ]}
            hitSlop={4}
            accessibilityLabel="Composer settings"
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={
                thinkingMode !== 'none'
                  ? c.isDark
                    ? Colors.primary[300]
                    : Colors.primary[500]
                  : c.textSecondary
              }
            />
            <View
              style={[
                styles.tuneBadge,
                thinkingMode === 'none' && {
                  backgroundColor: c.subtle,
                },
              ]}
            >
              <Text
                style={[
                  styles.tuneBadgeText,
                  thinkingMode === 'none' && { color: c.textTertiary },
                ]}
              >
                {thinkingBadge}
              </Text>
            </View>
          </Pressable>

          <TextInput
            ref={inputRef}
            style={[styles.composerInput, { color: c.textPrimary }]}
            value={input}
            onChangeText={setInput}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => {
              if (running) {
                if (input.trim()) {
                  enqueuePrompt(input.trim());
                  setInput('');
                }
              } else {
                sendChat();
              }
            }}
            returnKeyType="send"
            placeholder={running ? 'Queue a message…' : 'Message'}
            placeholderTextColor={c.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />

          {running && input.trim().length === 0 ? (
            <Pressable
              onPress={cancelTurn}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: c.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(60,60,67,0.09)',
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.88 : 1 }],
                },
              ]}
              hitSlop={4}
              accessibilityLabel="Stop"
            >
              <Ionicons name="stop" size={15} color={Colors.danger[400]} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                if (running) {
                  if (input.trim()) {
                    sendSteer();
                  }
                } else {
                  sendChat();
                }
              }}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor:
                    running || !sendDisabled
                      ? Colors.primary[500]
                      : c.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(60,60,67,0.07)',
                  opacity: pressed ? 0.75 : 1,
                  transform: [{ scale: pressed ? 0.88 : 1 }],
                },
              ]}
              disabled={!running && sendDisabled}
              hitSlop={4}
              accessibilityLabel={running ? 'Steer now' : 'Send'}
            >
              <Ionicons
                name={running ? 'flash' : 'arrow-up'}
                size={16}
                color={
                  running || !sendDisabled ? '#ffffff' : c.textTertiary
                }
              />
            </Pressable>
          )}
        </GlassCapsule>
      </Animated.View>

      <ComposerSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colors={c}
        models={Array.from(new Set([...providerModels, ...models]))}
        selectedModel={selectedModel}
        onSelectModel={(m) => {
          setSelectedModel(m);
          wsService.send({ type: 'model_select', sessionId, model: m });
        }}
        thinkingMode={thinkingMode}
        thinkingLevel={thinkingLevel}
        onThinking={(mode, level) => {
          setThinkingMode(mode);
          if (level) setThinkingLevel(level);
          sendThinkingConfig(mode, level);
        }}
        serviceTier={serviceTier}
        onServiceTier={(tier) => {
          setServiceTier(tier);
          wsService.send({ type: 'service_tier_select', sessionId, tier });
        }}
        accessMode={accessMode}
        onAccessMode={(mode) => {
          setAccessMode(mode);
          wsService.send({ type: 'access_mode_select', sessionId, mode });
        }}
        onInsertFile={() => {
          setInput((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + ' @' : '@'));
          inputRef.current?.focus();
        }}
        onReview={() => setShowDiffReview(true)}
        onCommand={(command) => enqueuePrompt(command)}
      />

      {promptModal?.visible && (
        <Modal transparent animationType="fade" onRequestClose={() => setPromptModal(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setPromptModal(null)}>
            <Pressable
              style={[styles.promptSheet, { backgroundColor: c.isDark ? '#2c2e33' : '#f2f2f6' }]}
              onPress={() => {}}
            >
              <BlurView
                tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
                intensity={Glass.blur.sheet}
                style={StyleSheet.absoluteFill}
              />
              <Text style={[styles.promptTitle, { color: c.textPrimary }]}>
                {promptModal.title}
              </Text>
              <TextInput
                autoFocus
                style={[
                  styles.promptInput,
                  {
                    color: c.textPrimary,
                    backgroundColor: c.isDark ? 'rgba(255,255,255,0.10)' : '#ffffff',
                  },
                ]}
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
              {/* UIAlertController-style stacked actions — hairline separated. */}
              <View style={[styles.promptActions, { borderTopColor: c.separator }]}>
                <Pressable
                  onPress={() => setPromptModal(null)}
                  style={({ pressed }) => [
                    styles.promptActionBtn,
                    { opacity: pressed ? 0.5 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.promptActionText,
                      {
                        color: c.isDark ? Colors.primary[300] : Colors.primary[500],
                        fontWeight: '400',
                      },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <View style={[styles.promptActionDivider, { backgroundColor: c.separator }]} />
                <Pressable
                  onPress={() => setPromptModal(null)}
                  style={({ pressed }) => [
                    styles.promptActionBtn,
                    { opacity: pressed ? 0.5 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.promptActionText,
                      {
                        color: c.isDark ? Colors.primary[300] : Colors.primary[500],
                        fontWeight: '600',
                      },
                    ]}
                  >
                    Done
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {errorToast && (
        <View style={styles.errorToast} pointerEvents="box-none">
          <GlassCapsule c={c} style={styles.errorToastCapsule} contentStyle={styles.errorToastContent}>
            <Ionicons name="warning-outline" size={14} color={Colors.danger[400]} />
            <Text style={[styles.errorToastText, { color: Colors.danger[400] }]}>{errorToast}</Text>
          </GlassCapsule>
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

      <AllFilesDiffView
        visible={showDiffReview}
        sessionId={sessionId ?? ''}
        projectPath={projectPath}
        onClose={() => setShowDiffReview(false)}
        onCommitSuccess={() => {
          wsService.send({ type: 'git_status_request', sessionId });
        }}
      />
    </Animated.View>
  );
}

function ToolBurstRenderer({
  burst,
  colors: c,
  isStreaming,
  isExpanded,
  onToggle,
  onReview,
}: {
  burst: { type: 'burst'; id: string; messages: ChatMessage[]; turnId: string };
  colors: ThemeColors;
  isStreaming: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  return (
    <View style={burstStyles.container}>
      <ToolBurstGroup
        colors={c}
        count={burst.messages.length}
        done={!isStreaming}
        durationMs={
          burst.messages.length > 1
            ? burst.messages[burst.messages.length - 1].timestamp - burst.messages[0].timestamp
            : 0
        }
        isExpanded={isExpanded}
        onToggle={onToggle}
      >
        {burst.messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} colors={c} />
        ))}
      </ToolBurstGroup>
      {!isStreaming && (
        <TurnEndActions messages={burst.messages} colors={c} onReview={onReview} />
      )}
    </View>
  );
}

function TurnEndActions({
  messages,
  colors: c,
  onReview,
}: {
  messages: ChatMessage[];
  colors: ThemeColors;
  onReview: () => void;
}) {
  const fileChanges = messages.filter((m) => m.kind === 'fileChange');
  if (fileChanges.length === 0) return null;

  return (
    <Pressable
      style={turnEndStyles.container}
      onPress={onReview}
      onLongPress={() => {
        const summary = fileChanges.map((m) => m.content).join('\n');
        Clipboard.setString(summary);
      }}
      hitSlop={4}
    >
      <Ionicons name="create-outline" size={12} color={c.textTertiary} />
      <Text style={[turnEndStyles.label, { color: c.textTertiary }]}>
        {fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''} changed
      </Text>
      <Text style={[turnEndStyles.sep, { color: c.textTertiary }]}>{'\u00B7'}</Text>
      <Text style={[turnEndStyles.link, { color: Colors.primary[400] }]}>Review diff</Text>
    </Pressable>
  );
}

function MessageBubble({
  msg,
  colors: c,
  onLongPress,
  onAnswerQuestion,
  onApprovePermission,
  onRejectPermission,
}: {
  msg: ChatMessage;
  colors: ThemeColors;
  onLongPress?: () => void;
  onAnswerQuestion?: (ans: string) => void;
  onApprovePermission?: () => void;
  onRejectPermission?: () => void;
}) {
  if (msg.eventType === 'user_input_prompt') {
    const rawQuestions = msg.meta?.questions as QuestionItem[] | undefined;
    const q: QuestionItem = rawQuestions?.[0] ?? { question: msg.content };
    return (
      <View style={styles.systemRow}>
        <AgentQuestionCard
          question={q}
          onAnswer={onAnswerQuestion}
          style={{ width: '100%' }}
        />
      </View>
    );
  }

  if (msg.eventType === 'permission_request') {
    const perm: PermissionItem = {
      requestId: (msg.meta?.requestId as string) ?? '',
      tool: (msg.meta?.tool as string) ?? '',
      action: (msg.meta?.action as string) ?? '',
      description: (msg.meta?.description as string) ?? msg.content,
    };
    return (
      <View style={styles.systemRow}>
        <AgentQuestionCard
          permission={perm}
          onApprove={onApprovePermission}
          onReject={onRejectPermission}
          style={{ width: '100%' }}
        />
      </View>
    );
  }
  if (msg.role === 'user') {
    const isLong = msg.content.length > 360 || (msg.content.match(/\n/g) ?? []).length > 8;
    return (
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={300}
        style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      >
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: c.isDark ? Colors.primary[600] : Colors.primary[500] }]}>
            <Text style={styles.userText} numberOfLines={isLong && !msg.isCollapsed ? 6 : undefined}>
              {msg.content}
            </Text>
            {isLong && msg.isCollapsed && (
              <Text style={styles.userCollapseHint}>Show more</Text>
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
          <View style={styles.assistantBubble}>
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
    const toolName =
      (msg.meta?.tool as string) ?? msg.content.replace(/^\uD83D\uDD27\s*/, '').split(' ')[0];
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
        <View
          style={[
            styles.systemBubble,
            isError ? styles.errorBubble : { backgroundColor: c.subtle },
          ]}
        >
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
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  label: {
    ...Typography.caption1,
    fontWeight: '500',
  },
  sep: {
    ...Typography.caption1,
  },
  link: {
    ...Typography.caption1,
    fontWeight: '600',
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
    paddingLeft: Spacing.xs + 2,
    paddingRight: Spacing.md,
    gap: Spacing.xs + 2,
  },
  headerHairline: {
    height: StyleSheet.hairlineWidth,
  },
  headerTitles: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: Spacing.xs,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    flexShrink: 1,
  },
  headerSubtitle: {
    ...Typography.caption2,
    marginTop: 1,
    marginLeft: 22,
  },
  headerMono: {
    fontFamily: FontFamily.mono,
    fontSize: 10.5,
  },
  headerAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBack: {
    marginRight: 2,
  },
  headerGroup: {
    marginLeft: 'auto',
  },
  headerGroupContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  headerGroupBtn: {
    minWidth: 32,
    height: 28,
    borderRadius: 999,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  headerGroupCount: {
    ...Typography.caption2,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  groupDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
  },

  statusDotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.25,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing['3xl'],
    gap: Spacing.sm,
  },
  emptyTitle: { ...Typography.title3 },
  emptySub: { ...Typography.footnote, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
  suggestionList: {
    marginTop: Spacing.xl - 4,
    gap: Spacing.sm - 2,
    width: '100%',
    maxWidth: 320,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md - 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: {
    ...Typography.subhead,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '500',
    flex: 1,
  },

  listContainer: {
    flex: 1,
  },
  /** Wraps transcript + empty state; its animated bottom inset tracks the keyboard. */
  contentArea: {
    flex: 1,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: 140,
    width: 34,
    height: 34,
    zIndex: 5,
  },
  scrollToBottomGlass: {
    flex: 1,
  },
  scrollPillContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadEarlierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: 4,
  },
  loadEarlierText: {
    ...Typography.footnote,
    fontWeight: '500',
  },

  messageList: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '78%',
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: 9,
    borderRadius: 19,
    borderCurve: 'continuous',
    shadowColor: '#08090a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 3,
    elevation: 1,
  },
  userText: { ...Typography.subhead, fontSize: 14.5, lineHeight: 20, color: '#ffffff' },
  userCollapseHint: {
    ...Typography.caption2,
    marginTop: 4,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '600',
  },
  assistantRow: { alignItems: 'flex-start' },
  assistantBubble: {
    maxWidth: '100%',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  assistantText: { ...Typography.subhead, fontSize: 14, lineHeight: 19 },
  systemRow: { alignItems: 'center' },
  systemBubble: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
  },
  systemText: { ...Typography.caption2, fontWeight: '500' },

  /** Messages-grade glass capsule: [tune][input][send/stop] — content row. */
  composerCapsule: {},
  composerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm - 2,
    paddingHorizontal: Spacing.sm - 2,
    paddingVertical: Spacing.sm - 2,
    minHeight: 48,
  },

  tuneButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tuneBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary[500],
  },
  tuneBadgeText: {
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '700',
    color: '#ffffff',
    fontFamily: FontFamily.mono,
  },

  composerInput: {
    ...Typography.subhead,
    flex: 1,
    minHeight: 24,
    maxHeight: 120,
    padding: 0,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  errorBubble: { backgroundColor: Colors.danger[400] + '1A' },
  errorText: { color: Colors.danger[400], ...Typography.caption2, fontWeight: '500' },

  dockedCardWrapper: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm - 2,
  },
  queueStrip: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm - 2,
  },
  queueStripContent: {
    paddingVertical: Spacing.sm - 2,
    paddingHorizontal: Spacing.md - 2,
    gap: 4,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  queueCountText: {
    ...Typography.caption2,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  queueTag: {
    ...Typography.caption2,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  queueChipsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm - 2,
    paddingVertical: 2,
  },
  queueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
    maxWidth: 200,
  },
  queueChipNum: {
    ...Typography.caption2,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  queueChipText: {
    ...Typography.caption1,
    maxWidth: 140,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  /** UIAlertController geometry: 270pt card, 14pt continuous radius. */
  promptSheet: {
    width: 270,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingTop: Spacing.xl,
    paddingBottom: 0,
    gap: Spacing.lg - 2,
    ...Shadows.elevated,
  },
  promptTitle: { ...Typography.headline, textAlign: 'center', marginHorizontal: Spacing.lg },
  promptInput: {
    ...Typography.subhead,
    borderRadius: 9,
    marginHorizontal: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 1,
  },
  promptActions: {
    marginTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  promptActionBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptActionDivider: {
    height: StyleSheet.hairlineWidth,
  },
  promptActionText: { ...Typography.subhead, fontSize: 17, lineHeight: 22 },
  errorToast: {
    position: 'absolute',
    bottom: 120,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  errorToastCapsule: {},
  errorToastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm - 2,
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: Spacing.md - 2,
  },
  errorToastText: { ...Typography.footnote, fontWeight: '500', flexShrink: 1 },
});
