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
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import { wsService } from '../../src/services/websocket';
import { useChatStore, type ChatMessage } from '../../src/stores/chat';
import { apiFetch } from '../../src/services/api';
import { FontFamily, STATUS_COLORS, Typography, Spacing, Colors, CornerRadius, Glass, Shadows } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { GlassButton } from '../../src/components/GlassKit';
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

const HEADER_HEIGHT = 48;

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
    addUserMessage(input.trim());
    wsService.send({ type: 'steer_input', sessionId, content: input.trim() });
    setInput('');
  }

  function cancelTurn() {
    if (!sessionId) return;
    wsService.send({ type: 'cancel_turn', sessionId });
  }

  function approveAction(requestId?: string) {
    if (!sessionId) return;
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

  // Keyboard tracking on the UI thread (the keyboardLayoutGuide equivalent):
  // the content area's animated bottom inset makes everything below it —
  // docked cards, queue, composer — hug the keyboard frame in real time,
  // including interactive swipe-to-dismiss. Android relies on window resize.
  const keyboard = useAnimatedKeyboard();
  const listKeyboardInset = useAnimatedStyle(() => ({
    flex: 1,
    paddingBottom: Platform.OS === 'ios' ? keyboard.height.value : 0,
  }));
  // The keyboard frame already covers the home-indicator area — collapse the
  // safe-area padding as it rises so the field sits flush on the keyboard.
  const composerStyle = useAnimatedStyle(() => ({
    paddingHorizontal: Spacing.md + 2,
    paddingTop: Spacing.sm - 2,
    paddingBottom:
      Platform.OS === 'ios' ? Math.max(0, insets.bottom - keyboard.height.value) : insets.bottom,
  }));

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
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
              style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.4 : 1 }]}
              hitSlop={4}
              accessibilityLabel="Collapse"
            >
              <Ionicons name="chevron-down" size={20} color={c.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setShowDiffReview(true)}
              style={({ pressed }) => [styles.headerTitles, { opacity: pressed ? 0.6 : 1 }]}
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
            <View style={styles.spacer} />

            {gitStatus.trim().length > 0 && (
              <Pressable
                onPress={() => setShowDiffReview(true)}
                style={({ pressed }) => [
                  styles.headerDiffPill,
                  {
                    backgroundColor: Colors.primary[500] + (c.isDark ? '24' : '14'),
                    opacity: pressed ? 0.55 : 1,
                  },
                ]}
                hitSlop={4}
              >
                <Ionicons name="git-compare-outline" size={12} color={Colors.primary[400]} />
                <Text style={[styles.headerDiffPillText, { color: Colors.primary[400] }]}>
                  {gitStatus.split('\n').filter(Boolean).length}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={toggleSessionControl}
              style={({ pressed }) => [
                styles.headerControlPill,
                {
                  backgroundColor:
                    sessionOwner === 'remote'
                      ? c.successBg
                      : c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                  opacity: pressed ? 0.55 : 1,
                },
              ]}
              hitSlop={4}
            >
              <Ionicons
                name={sessionOwner === 'remote' ? 'phone-portrait' : 'desktop-outline'}
                size={12}
                color={sessionOwner === 'remote' ? Colors.success[400] : c.textTertiary}
              />
              <Text
                style={[
                  styles.headerControlText,
                  { color: sessionOwner === 'remote' ? Colors.success[400] : c.textTertiary },
                ]}
              >
                {sessionOwner === 'remote' ? 'Mobile' : 'Take Control'}
              </Text>
            </Pressable>
            <Pressable
              ref={moreBtnRef}
              onPress={openMoreMenu}
              style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.4 : 1 }]}
              hitSlop={4}
              accessibilityLabel="More actions"
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={c.textSecondary} />
            </Pressable>
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

      <Animated.View style={listKeyboardInset}>
        <View style={styles.contentArea}>
          {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyOrb,
              {
                backgroundColor: Colors.primary[500] + (c.isDark ? '30' : '12'),
                borderWidth: 1,
                borderColor: Colors.primary[500] + (c.isDark ? '59' : '2E'),
              },
            ]}
          >
            <Text style={[styles.emptyOrbGlyph, { color: Colors.primary[400] }]}>{'\u276F'}</Text>
          </View>
          <Text style={styles.emptyTitle}>Start a conversation</Text>
          <Text style={styles.emptySub}>
            Remote-control your coding agent — ask, review, steer.
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
                  { backgroundColor: c.subtle, opacity: pressed ? 0.55 : 1 },
                ]}
              >
                <Ionicons name={s.icon} size={16} color={c.textTertiary} />
                <Text style={[styles.suggestionText, { color: c.textSecondary }]} numberOfLines={1}>
                  {s.text}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={c.textTertiary} />
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
            style={[
              styles.scrollToBottomBtn,
              scrollBtnStyle,
              {
                bottom: insets.bottom + 140,
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.elevated
                  : Glass.opacity.light.elevated,
              },
            ]}
            pointerEvents={isNearBottom ? 'none' : 'auto'}
          >
            <Pressable
              onPress={scrollToBottom}
              hitSlop={4}
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Scroll to latest"
            >
              <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
            </Pressable>
          </Animated.View>
        </View>
        )}
        </View>
      </Animated.View>

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
        <Animated.View
          entering={FadeInDown.duration(Glass.morph.fast)}
          style={[styles.queueStrip, { backgroundColor: c.subtle }]}
        >
          <View style={styles.queueHeaderRow}>
            <View style={styles.queueTitleGroup}>
              <Ionicons name="time-outline" size={13} color={Colors.primary[400]} />
              <Text style={[styles.queueTag, { color: Colors.primary[400] }]}>Queued</Text>
              <Text style={[styles.queueCountText, { color: c.textTertiary }]}>
                {promptQueue.length}
              </Text>
            </View>
            <Pressable onPress={clearQueue} hitSlop={6}>
              <Text style={[Typography.caption2, { color: c.textTertiary, fontWeight: '600' }]}>
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
                style={[styles.queueChip, { backgroundColor: c.elevated }]}
              >
                <Text style={[styles.queueChipNum, { color: Colors.primary[500] }]}>#{idx + 1}</Text>
                <Text style={[styles.queueChipText, { color: c.textPrimary }]} numberOfLines={1}>
                  {item}
                </Text>
                <Pressable onPress={() => removeQueuedPrompt(idx)} hitSlop={6}>
                  <Ionicons name="close-circle" size={14} color={c.textTertiary} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
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

        <View style={[styles.composerField, { backgroundColor: c.subtle }]}>
          <Pressable
            onPress={() => {
              wsService.send({ type: 'model_list_request', sessionId });
              setSettingsOpen(true);
            }}
            style={({ pressed }) => [
              styles.tuneButton,
              {
                backgroundColor: c.isDark
                  ? 'rgba(25,26,29,0.85)'
                  : 'rgba(255,255,255,0.92)',
                opacity: pressed ? 0.55 : 1,
              },
            ]}
            hitSlop={4}
            accessibilityLabel="Composer settings"
          >
            <Ionicons name="reorder-three-outline" size={16} color={c.textSecondary} />
            <View style={[styles.tuneBadge, { backgroundColor: Colors.primary[500] }]}>
              <Text style={styles.tuneBadgeText}>{thinkingBadge}</Text>
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
            placeholder={running ? 'Type to queue next prompt...' : 'Ask anything...'}
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
                { backgroundColor: c.subtle, opacity: pressed ? 0.55 : 1 },
              ]}
              hitSlop={4}
              accessibilityLabel="Stop"
            >
              <Ionicons name="stop" size={13} color={Colors.danger[400]} />
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
                  backgroundColor: running || !sendDisabled ? Colors.primary[500] : c.subtle,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              disabled={!running && sendDisabled}
              hitSlop={4}
              accessibilityLabel={running ? 'Steer now' : 'Send'}
            >
              <Ionicons
                name={running ? 'flash' : 'arrow-up'}
                size={15}
                color={running || !sendDisabled ? '#ffffff' : c.textTertiary}
              />
            </Pressable>
          )}
        </View>
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
              style={[
                styles.promptSheet,
                {
                  backgroundColor: c.isDark
                    ? Glass.opacity.dark.elevated
                    : Glass.opacity.light.surface,
                },
              ]}
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
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.subtle
                      : Glass.opacity.light.subtle,
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
              <View style={styles.promptActions}>
                <Pressable
                  onPress={() => setPromptModal(null)}
                  style={({ pressed }) => [
                    styles.promptCancelBtn,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.promptCancelText, { color: c.textSecondary }]}>Cancel</Text>
                </Pressable>
                <GlassButton
                  c={c}
                  label="Done"
                  onPress={() => setPromptModal(null)}
                  variant="primary"
                  style={styles.promptDoneBtn}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {errorToast && (
        <View style={styles.errorToast}>
          <BlurView
            tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={Glass.blur.modal}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: Colors.danger[400] + '26',
                borderRadius: CornerRadius.medium,
              },
            ]}
            pointerEvents="none"
          />
          <Ionicons name="warning-outline" size={14} color={Colors.danger[400]} />
          <Text style={[styles.errorToastText, { color: Colors.danger[400] }]}>{errorToast}</Text>
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
    </View>
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
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: c.subtle }]}>
            <Text
              style={[styles.userText, { color: c.textPrimary }]}
              numberOfLines={isLong && !msg.isCollapsed ? 6 : undefined}
            >
              {msg.content}
            </Text>
            {isLong && (
              <Text style={[styles.userCollapseHint, { color: c.textTertiary }]}>
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
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  headerHairline: {
    height: StyleSheet.hairlineWidth,
  },
  headerTitles: {
    flexShrink: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerTitle: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '600',
    flexShrink: 1,
  },
  headerSubtitle: {
    ...Typography.caption2,
    marginTop: 1,
    marginLeft: 25,
  },
  headerMono: {
    fontFamily: FontFamily.mono,
    fontSize: 10.5,
  },
  headerAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerDiffPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: CornerRadius.small,
  },
  headerDiffPillText: {
    ...Typography.caption2,
    fontWeight: '700',
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  headerControlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: CornerRadius.small,
  },
  headerControlText: {
    ...Typography.caption2,
    fontWeight: '600',
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
    padding: Spacing['3xl'],
    gap: Spacing.sm,
  },
  emptyOrb: {
    width: 56,
    height: 56,
    borderRadius: 17,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyOrbGlyph: {
    fontFamily: FontFamily.monoSemiBold,
    fontSize: 22,
    lineHeight: 26,
  },
  emptyTitle: { ...Typography.headline },
  emptySub: { ...Typography.footnote, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
  suggestionList: {
    marginTop: Spacing.xl - 4,
    gap: Spacing.sm - 2,
    width: '100%',
    maxWidth: 300,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md - 2,
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: Spacing.sm + 3,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
  },
  suggestionText: {
    ...Typography.subhead,
    fontSize: 13.5,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
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
    maxWidth: '80%',
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: 9,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  userText: { ...Typography.subhead, fontSize: 14, lineHeight: 19 },
  userCollapseHint: {
    ...Typography.caption2,
    marginTop: 4,
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

  /** iMessage-style filled capsule: [≡ tune][input][send/stop]. */
  composerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    borderRadius: 20,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.xs + 2,
    paddingVertical: Spacing.xs + 2,
    minHeight: 44,
  },

  tuneButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tuneBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 15,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  spacer: { flex: 1 },

  errorBubble: { backgroundColor: Colors.danger[400] + '1A' },
  errorText: { color: Colors.danger[400], ...Typography.caption2, fontWeight: '500' },

  dockedCardWrapper: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm - 2,
  },
  queueStrip: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm - 2,
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
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
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: CornerRadius.small,
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
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  promptSheet: {
    width: '85%',
    maxWidth: 340,
    borderRadius: CornerRadius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadows.elevated,
  },
  promptTitle: { ...Typography.headline, textAlign: 'center' },
  promptInput: {
    ...Typography.subhead,
    borderRadius: CornerRadius.medium,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md - 2,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.md - 2,
  },
  promptCancelBtn: {
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.small,
  },
  promptCancelText: { ...Typography.subhead, fontSize: 14, fontWeight: '500' },
  promptDoneBtn: { minWidth: 88 },
  errorToast: {
    position: 'absolute',
    bottom: 120,
    left: Spacing.lg,
    right: Spacing.lg,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm - 2,
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: Spacing.md - 2,
    ...Shadows.elevated,
  },
  errorToastText: { ...Typography.footnote, fontWeight: '500' },
});
