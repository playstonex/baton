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
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import Svg, { Circle } from 'react-native-svg';
import { wsService } from '../../src/services/websocket';
import { useChatStore, type ChatMessage } from '../../src/stores/chat';
import { apiFetch } from '../../src/services/api';
import { FontFamily, STATUS_COLORS, Typography, Spacing, Colors, CornerRadius, Radius, Glass, Shadows } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { GlassButton } from '../../src/components/GlassKit';
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

function ContextProgressRing({ fraction, color }: { fraction: number; color: string }) {
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - Math.min(fraction, 1));
  const pct = Math.round(fraction * 100);

  let ringColor = color;
  if (fraction > 0.85) ringColor = Colors.danger[400];
  else if (fraction > 0.65) ringColor = Colors.warning[400];

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
      <Text style={[progressStyles.label, { color: ringColor }]}>{pct}</Text>
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
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('local');
  const [planMode, setPlanMode] = useState(false);
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
  const [menu, setMenu] = useState<{
    title?: string;
    options: MenuOption[];
    onSelect: (i: number) => void;
    anchor?: { x: number; y: number; width: number; height: number };
  } | null>(null);
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
      {
        label: `${thinkingMode === 'none' ? '\u2713 ' : ''}Off`,
        selected: thinkingMode === 'none',
      },
      {
        label: `${thinkingMode === 'auto' ? '\u2713 ' : ''}Auto`,
        selected: thinkingMode === 'auto',
      },
      { separator: true },
      {
        label: `${thinkingMode === 'level' && thinkingLevel === 'minimal' ? '\u2713 ' : ''}Minimal`,
        selected: thinkingMode === 'level' && thinkingLevel === 'minimal',
      },
      {
        label: `${thinkingMode === 'level' && thinkingLevel === 'low' ? '\u2713 ' : ''}Low`,
        selected: thinkingMode === 'level' && thinkingLevel === 'low',
      },
      {
        label: `${thinkingMode === 'level' && thinkingLevel === 'medium' ? '\u2713 ' : ''}Medium`,
        selected: thinkingMode === 'level' && thinkingLevel === 'medium',
      },
      {
        label: `${thinkingMode === 'level' && thinkingLevel === 'high' ? '\u2713 ' : ''}High`,
        selected: thinkingMode === 'level' && thinkingLevel === 'high',
      },
      {
        label: `${thinkingMode === 'level' && thinkingLevel === 'xhigh' ? '\u2713 ' : ''}X-High`,
        selected: thinkingMode === 'level' && thinkingLevel === 'xhigh',
      },
      { separator: true },
      { label: 'Normal Speed', selected: serviceTier === 'default' },
      { label: 'Fast Speed', selected: serviceTier === 'fast' },
    ];
    setMenu({
      title: 'Thinking & Speed',
      anchor,
      options,
      onSelect: (index) => {
        if (index === 0) {
          setThinkingMode('none');
          sendThinkingConfig('none');
        } else if (index === 1) {
          setThinkingMode('auto');
          sendThinkingConfig('auto');
        } else if (index === 3) {
          setThinkingMode('level');
          setThinkingLevel('minimal');
          sendThinkingConfig('level', 'minimal');
        } else if (index === 4) {
          setThinkingMode('level');
          setThinkingLevel('low');
          sendThinkingConfig('level', 'low');
        } else if (index === 5) {
          setThinkingMode('level');
          setThinkingLevel('medium');
          sendThinkingConfig('level', 'medium');
        } else if (index === 6) {
          setThinkingMode('level');
          setThinkingLevel('high');
          sendThinkingConfig('level', 'high');
        } else if (index === 7) {
          setThinkingMode('level');
          setThinkingLevel('xhigh');
          sendThinkingConfig('level', 'xhigh');
        } else if (index === 8) {
          setThinkingMode('level');
          setThinkingLevel('medium');
        } else if (index === 9) {
          setServiceTier('default');
          wsService.send({ type: 'service_tier_select', sessionId, tier: 'default' });
        } else if (index === 10) {
          setServiceTier('fast');
          wsService.send({ type: 'service_tier_select', sessionId, tier: 'fast' });
        }
      },
    });
  }

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

  async function openGitActionsMenu() {
    const anchor = await measureAnchor(gitActionsBtnRef);
    setMenu({
      title: 'Git Actions',
      anchor,
      options: [
        { label: 'Review All Changes' },
        { label: 'Status' },
        { label: 'Commit...' },
        { label: 'Push' },
        { label: 'Pull' },
      ],
      onSelect: (index) => {
        if (index === 0) {
          setShowDiffReview(true);
        }
        if (index === 1) {
          wsService.send({ type: 'git_status_request', sessionId });
        }
        if (index === 2) {
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
        if (index === 3) {
          wsService.send({ type: 'git_push', sessionId });
        }
        if (index === 4) {
          wsService.send({ type: 'git_pull', sessionId });
        }
      },
    });
  }

  const statusColor = STATUS_COLORS[agentStatus] ?? Colors.surface[400];
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.headerOverlay}>
        <BlurView
          tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          intensity={Glass.blur.nav}
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
            <Pressable
              onPress={() => setShowDiffReview(true)}
              style={({ pressed }) => [styles.headerTitles, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
                {projectPath ? projectPath.split('/').pop() : sessionId?.slice(0, 8)}
              </Text>
              <Text style={[styles.headerSubtitle, { color: c.textTertiary }]} numberOfLines={1}>
                {agentStatus.replace('_', ' ')}
                {gitStatus ? ` \u2022 ${gitStatus.split('\n').filter(Boolean).length} changed` : ''}
              </Text>
            </Pressable>
            <View style={styles.spacer} />

            {gitStatus.trim().length > 0 && (
              <Pressable
                onPress={() => setShowDiffReview(true)}
                style={({ pressed }) => [
                  styles.headerDiffPill,
                  {
                    backgroundColor: pressed
                      ? c.subtle
                      : c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                    opacity: pressed ? 0.8 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
                hitSlop={4}
              >
                <Ionicons name="document-text-outline" size={13} color={Colors.primary[500]} />
                <Text style={[styles.headerDiffPillText, { color: Colors.primary[500] }]}>
                  {gitStatus.split('\n').filter(Boolean).length}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={toggleSessionControl}
              style={({ pressed }) => [
                styles.headerControlPill,
                {
                  backgroundColor: pressed
                    ? c.subtle
                    : sessionOwner === 'remote'
                      ? c.successBg
                      : c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                  borderColor:
                    sessionOwner === 'remote'
                      ? 'transparent'
                      : c.isDark
                        ? Glass.opacity.dark.border
                        : Glass.opacity.light.border,
                  opacity: pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
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
              ref={gitActionsBtnRef}
              onPress={openGitActionsMenu}
              style={({ pressed }) => [
                styles.headerAction,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
              hitSlop={4}
            >
              <Ionicons name="git-branch-outline" size={16} color={c.textTertiary} />
            </Pressable>
            <Pressable
              onPress={() => router.push(`/terminal/${sessionId}`)}
              style={({ pressed }) => [
                styles.headerAction,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
              hitSlop={4}
            >
              <Ionicons name="terminal-outline" size={18} color={c.textTertiary} />
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.headerAction,
                { marginLeft: 2, opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
              hitSlop={4}
            >
              <Ionicons name="chevron-down" size={20} color={c.textTertiary} />
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

      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyIconWrap,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.subtle
                  : Glass.opacity.light.subtle,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.isDark
                  ? Glass.opacity.dark.border
                  : Glass.opacity.light.border,
              },
            ]}
          >
            <Ionicons name="chatbubble-outline" size={26} color={c.textTertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Start a conversation</Text>
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
            contentContainerStyle={[styles.messageList, { paddingTop: insets.top + HEADER_HEIGHT }]}
            renderItem={renderGroupedItem}
            onScroll={handleScroll}
            scrollEventThrottle={64}
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
          {!isNearBottom && (
            <Pressable
              style={({ pressed }) => [
                styles.scrollToBottomBtn,
                {
                  bottom: insets.bottom + 140,
                  backgroundColor: c.isDark
                    ? Glass.opacity.dark.elevated
                    : Glass.opacity.light.elevated,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.isDark
                    ? Glass.opacity.dark.border
                    : Glass.opacity.light.border,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}
              onPress={scrollToBottom}
              hitSlop={4}
            >
              <BlurView
                tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
                intensity={Glass.blur.tooltip}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {(activePermission || waitingApproval) && (
        <View style={styles.dockedCardWrapper}>
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
        </View>
      )}

      {activePrompt && activePrompt.questions?.length > 0 && (
        <View style={styles.dockedCardWrapper}>
          <AgentQuestionCard
            question={activePrompt.questions[0]}
            onAnswer={answerQuestion}
            compact
          />
        </View>
      )}

      {promptQueue.length > 0 && (
        <View
          style={[
            styles.queueStrip,
            {
              backgroundColor: c.isDark
                ? Glass.opacity.dark.elevated
                : Glass.opacity.light.surface,
              borderColor: c.isDark
                ? Glass.opacity.dark.border
                : Glass.opacity.light.border,
            },
          ]}
        >
          <BlurView
            tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={Glass.blur.card}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.queueHeaderRow}>
            <View style={styles.queueTitleGroup}>
              <Ionicons name="time-outline" size={14} color={Colors.primary[500]} />
              <Text style={[styles.queueCountText, { color: c.textPrimary }]}>
                Queue ({promptQueue.length})
              </Text>
            </View>
            <Pressable onPress={clearQueue} hitSlop={6}>
              <Text style={[Typography.caption2, { color: Colors.danger[400], fontWeight: '600' }]}>
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
                style={[
                  styles.queueChip,
                  {
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.subtle
                      : Glass.opacity.light.elevated,
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                  },
                ]}
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
        </View>
      )}

      <View style={[styles.composerWrapper, { paddingBottom: insets.bottom }]}>
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
        <View
          style={[
            styles.composerCard,
            {
              backgroundColor: c.isDark
                ? Glass.opacity.dark.surface
                : Glass.opacity.light.surface,
              borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
            },
          ]}
        >
          <BlurView
            tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={Glass.blur.card}
            style={StyleSheet.absoluteFill}
          />

          {planMode && (
            <View
              style={[
                styles.planBadge,
                {
                  backgroundColor: Colors.warning[400] + (c.isDark ? '26' : '1A'),
                },
              ]}
            >
              <Ionicons name="list-outline" size={11} color={Colors.warning[400]} />
              <Text style={[styles.planBadgeText, { color: Colors.warning[400] }]}>Plan</Text>
            </View>
          )}

          <View style={styles.composerInputRow}>
            <TextInput
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
          </View>

          <View style={styles.bottomBar}>
            <Pressable
              ref={attachBtnRef}
              style={({ pressed }) => [
                styles.metaButton,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] },
              ]}
              hitSlop={4}
              accessibilityLabel="Attach"
              onPress={openAttachmentMenu}
            >
              <Ionicons name="add" size={18} color={c.textTertiary} />
            </Pressable>

            <Pressable
              ref={modelBtnRef}
              style={({ pressed }) => [
                styles.modelButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              hitSlop={4}
              accessibilityLabel="Select model"
              onPress={async () => {
                wsService.send({ type: 'model_list_request', sessionId });
                const anchor = await measureAnchor(modelBtnRef);
                const availableModels = Array.from(new Set([...providerModels, ...models]));
                setMenu({
                  title: 'Model',
                  anchor,
                  options: availableModels.map((m) => ({
                    label: shortModelName(m),
                    selected: m === selectedModel,
                  })),
                  onSelect: (index) => {
                    setSelectedModel(availableModels[index]);
                    wsService.send({
                      type: 'model_select',
                      sessionId,
                      model: availableModels[index],
                    });
                  },
                });
              }}
            >
              {serviceTier === 'fast' && (
                <Ionicons name="flash" size={10} color={Colors.warning[400]} style={{ marginRight: 2 }} />
              )}
              <Text style={[styles.modelLabel, { color: c.textTertiary }]}>
                {shortModelName(selectedModel)}
              </Text>
              <Ionicons
                name="chevron-down"
                size={10}
                color={c.textTertiary}
                style={{ marginLeft: 2 }}
              />
            </Pressable>

            <Pressable
              ref={reasoningBtnRef}
              style={({ pressed }) => [
                styles.metaButton,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] },
              ]}
              hitSlop={4}
              accessibilityLabel="Reasoning effort"
              onPress={openReasoningMenu}
            >
              <View style={styles.reasoningButtonInner}>
                <Ionicons
                  name="bulb-outline"
                  size={16}
                  color={thinkingMode === 'level' ? Colors.warning[400] : c.textTertiary}
                />
                {thinkingMode === 'level' && (
                  <Text style={[styles.reasoningBadge, { color: Colors.warning[400] }]}>
                    {THINKING_LEVEL_SHORT[thinkingLevel]}
                  </Text>
                )}
              </View>
            </Pressable>

            <View style={styles.spacer} />

            <Pressable
              style={({ pressed }) => [
                styles.metaButton,
                { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] },
              ]}
              hitSlop={4}
              accessibilityLabel="Voice input"
              onPress={() => {}}
            >
              <Ionicons name="mic-outline" size={18} color={c.textTertiary} />
            </Pressable>

            {running && (
              <Pressable
                onPress={cancelTurn}
                style={({ pressed }) => [
                  styles.stopButton,
                  {
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.elevated
                      : Glass.opacity.light.elevated,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                    transform: [{ scale: pressed ? 0.92 : 1 }],
                  },
                ]}
                hitSlop={4}
                accessibilityLabel="Stop"
              >
                <Ionicons name="stop" size={12} color={Colors.danger[400]} />
              </Pressable>
            )}

            {running && input.trim().length > 0 && (
              <Pressable
                onPress={sendSteer}
                style={({ pressed }) => [
                  styles.steerButton,
                  {
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.elevated
                      : Glass.opacity.light.elevated,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                  },
                ]}
                hitSlop={4}
                accessibilityLabel="Steer immediately"
              >
                <Ionicons name="flash" size={12} color={Colors.warning[400]} />
                <Text style={[styles.steerLabel, { color: c.textPrimary }]}>Steer</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => {
                if (running) {
                  if (input.trim()) {
                    enqueuePrompt(input.trim());
                    setInput('');
                  }
                } else {
                  sendChat();
                }
              }}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: sendDisabled
                    ? c.isDark
                      ? Glass.opacity.dark.subtle
                      : Glass.opacity.light.subtle
                    : running
                      ? Colors.primary[500]
                      : c.isDark
                        ? Colors.surface[50]
                        : Colors.surface[900],
                  transform: [{ scale: pressed ? 0.9 : 1 }],
                },
              ]}
              disabled={sendDisabled}
              hitSlop={4}
              accessibilityLabel={running ? 'Queue prompt' : 'Send'}
            >
              <Ionicons
                name={running ? 'add' : 'arrow-up'}
                size={14}
                color={
                  sendDisabled
                    ? c.textTertiary
                    : running
                      ? '#ffffff'
                      : c.isDark
                        ? Colors.surface[900]
                        : '#ffffff'
                }
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.secondaryBar}>
          <Pressable
            ref={runtimeBtnRef}
            style={({ pressed }) => [
              styles.secondaryPill,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.subtle
                  : Glass.opacity.light.subtle,
                borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            hitSlop={4}
            onPress={openRuntimePicker}
          >
            <Ionicons
              name={runtimeMode === 'cloud' ? 'cloud-outline' : 'laptop-outline'}
              size={13}
              color={c.textTertiary}
            />
            <Text style={[styles.secondaryLabel, { color: c.textTertiary }]}>
              {runtimeMode === 'cloud' ? 'Cloud' : 'Local'}
            </Text>
            <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
          </Pressable>

          <Pressable
            ref={accessBtnRef}
            style={({ pressed }) => [
              styles.secondaryPill,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.subtle
                  : Glass.opacity.light.subtle,
                borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            hitSlop={4}
            onPress={openAccessModeMenu}
          >
            <Ionicons
              name={accessMode === 'full-access' ? 'shield-outline' : 'shield-checkmark-outline'}
              size={13}
              color={c.textTertiary}
            />
            <Ionicons name="chevron-down" size={9} color={c.textTertiary} />
          </Pressable>

          <View style={styles.spacer} />

          <Pressable
            ref={branchBtnRef}
            style={({ pressed }) => [
              styles.secondaryPill,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.subtle
                  : Glass.opacity.light.subtle,
                borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            hitSlop={4}
            onPress={openGitBranchMenu}
          >
            <Ionicons name="git-branch-outline" size={13} color={c.textTertiary} />
            <Text style={[styles.secondaryLabel, { color: c.textTertiary, fontFamily: FontFamily.mono, fontSize: 11 }]}>
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
            <Pressable
              style={[
                styles.promptSheet,
                {
                  backgroundColor: c.isDark
                    ? Glass.opacity.dark.elevated
                    : Glass.opacity.light.surface,
                  borderColor: c.isDark
                    ? Glass.opacity.dark.border
                    : Glass.opacity.light.border,
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
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
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
                backgroundColor: Colors.danger[400] + '22',
                borderRadius: CornerRadius.medium,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: Colors.danger[400] + '55',
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

function TurnEndActions({ messages, colors: c }: { messages: ChatMessage[]; colors: ThemeColors }) {
  const fileChanges = messages.filter((m) => m.kind === 'fileChange');
  if (fileChanges.length === 0) return null;

  return (
    <View style={turnEndStyles.container}>
      <Pressable
        style={[turnEndStyles.pill, { backgroundColor: c.subtle }]}
        onPress={() => {
          const summary = fileChanges.map((m) => m.content).join('\n');
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
          <View style={[styles.userBubble, { backgroundColor: Colors.primary[500] }]}>
            <Text
              style={styles.userText}
              numberOfLines={isLong && !msg.isCollapsed ? 6 : undefined}
            >
              {msg.content}
            </Text>
            {isLong && (
              <Text style={styles.userCollapseHint}>{msg.isCollapsed ? 'Show more' : ''}</Text>
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
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  headerHairline: {
    height: StyleSheet.hairlineWidth,
  },
  headerTitles: {
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: FontFamily.monoSemiBold,
  },
  headerSubtitle: {
    ...Typography.caption2,
    marginTop: 1,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
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
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
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
    padding: Spacing['3xl'],
    gap: Spacing.sm,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyTitle: { ...Typography.subhead, fontWeight: '600' },
  emptySub: { ...Typography.footnote, textAlign: 'center', lineHeight: 18 },

  listContainer: {
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
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    borderCurve: 'continuous',
  },
  userText: { ...Typography.subhead, fontSize: 14, color: '#fff', lineHeight: 19 },
  userCollapseHint: {
    ...Typography.caption2,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  assistantRow: { alignItems: 'flex-start' },
  assistantBubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderCurve: 'continuous',
    borderWidth: 1,
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

  composerWrapper: {
    paddingHorizontal: Spacing.md + 2,
    paddingTop: Spacing.sm + 2,
  },

  composerCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },

  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: CornerRadius.small,
    gap: 4,
  },
  planBadgeText: {
    ...Typography.caption2,
    fontWeight: '600',
  },

  composerInputRow: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 4,
  },
  composerInput: {
    ...Typography.subhead,
    minHeight: 36,
    maxHeight: 120,
    padding: 0,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg - 2,
    paddingTop: 2,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
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
    ...Typography.caption1,
    fontFamily: FontFamily.mono,
  },
  reasoningButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reasoningBadge: {
    ...Typography.caption2,
    fontSize: 9,
    fontWeight: '600',
    fontFamily: FontFamily.mono,
  },
  stopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    paddingHorizontal: Spacing.sm + 2,
    paddingTop: Spacing.sm,
    paddingBottom: 2,
    gap: Spacing.sm - 2,
  },
  secondaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md - 2,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    gap: 4,
  },
  secondaryLabel: {
    ...Typography.caption1,
    fontWeight: '500',
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
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
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
    ...Typography.caption1,
    fontWeight: '600',
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
    borderWidth: StyleSheet.hairlineWidth,
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
  steerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    height: 32,
    borderRadius: 16,
  },
  steerLabel: {
    ...Typography.caption2,
    fontWeight: '600',
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
    borderRadius: CornerRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadows.elevated,
  },
  promptTitle: { ...Typography.headline, textAlign: 'center' },
  promptInput: {
    ...Typography.subhead,
    borderWidth: StyleSheet.hairlineWidth,
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
    borderWidth: StyleSheet.hairlineWidth,
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
