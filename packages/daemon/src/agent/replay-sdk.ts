import type {
  AgentConfig,
  ModelInfo,
  ParsedEvent,
  SdkAgentAdapter,
  SpawnConfig,
} from '@baton/shared';

export const REPLAY_MODELS: ModelInfo[] = [
  {
    id: 'showcase',
    name: 'Showcase (Tools & Diffs)',
    description: 'Full tool activity, bash exec and diffs',
  },
  {
    id: 'approval',
    name: 'Approval Flow',
    description: 'Simulates write approval and decision wait',
  },
  {
    id: 'question',
    name: 'Question Prompt',
    description: 'Simulates interactive multi-choice question',
  },
  {
    id: 'multi-turn',
    name: 'Multi-turn Conversation',
    description: 'Simulates step-by-step chat turns',
  },
];

export class ReplaySdkAdapter implements SdkAgentAdapter {
  readonly name = 'Replay (dev)';
  readonly agentType = 'replay' as const;

  selectedModel: string | null = 'showcase';
  private currentAbort: (() => void) | null = null;
  private resolveApproval: ((approved: boolean) => void) | null = null;

  detect(_projectPath: string): boolean {
    return true; // Always available without network or paid models
  }

  isSdkAvailable(): boolean {
    return true;
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'echo',
      args: ['[Baton Replay Mode Active]'],
      cwd: config.projectPath,
      env: {},
    };
  }

  parseOutput(_raw: string): ParsedEvent[] {
    return [];
  }

  async startSession(
    _config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    let turnCount = 0;
    const model = this.selectedModel || 'showcase';
    let stopped = false;

    const runTurn = async (userPrompt?: string) => {
      turnCount++;
      const now = Date.now();

      // 1. Thinking
      onEvent({ type: 'status_change', status: 'thinking', timestamp: now });
      onEvent({
        type: 'thinking',
        content: `Analyzing workspace context for: "${userPrompt || 'Initial setup'}" (Turn #${turnCount})...`,
        timestamp: now,
      });

      await new Promise((r) => setTimeout(r, 600));
      if (stopped) return;

      // 2. Executing tool
      onEvent({ type: 'status_change', status: 'executing', timestamp: Date.now() });
      onEvent({
        type: 'tool_call_start',
        callId: `call_${turnCount}_1`,
        tool: 'bash',
        title: 'Run test suite',
        args: { command: 'pnpm test' },
        timestamp: Date.now(),
      });
      onEvent({
        type: 'command_exec',
        command: 'pnpm test',
        output:
          'PASS packages/shared/src/__tests__/agent-state.test.ts\nTests: 8 passed, 8 total\nTime: 180ms',
        exitCode: 0,
        timestamp: Date.now(),
      });
      onEvent({
        type: 'tool_call_end',
        callId: `call_${turnCount}_1`,
        success: true,
        durationMs: 180,
        timestamp: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 500));
      if (stopped) return;

      // 3. File modifications
      onEvent({
        type: 'file_change',
        path: 'src/example.ts',
        changeType: 'modify',
        diff: '@@ -1,3 +1,4 @@\n export const a = 1;\n+export const b = 2;\n',
        timestamp: Date.now(),
      });

      // Scenario specific branch
      if (model === 'approval') {
        onEvent({ type: 'status_change', status: 'waiting_input', timestamp: Date.now() });
        onEvent({
          type: 'permission_request',
          requestId: `req_${turnCount}`,
          tool: 'write_file',
          action: 'write',
          description: 'Apply modifications to config/database.ts',
          timestamp: Date.now(),
        });
        const approved = await new Promise<boolean>((resolve) => {
          this.resolveApproval = resolve;
        });
        this.resolveApproval = null;
        if (stopped) return;

        onEvent({
          type: 'permission_response',
          requestId: `req_${turnCount}`,
          approved,
          timestamp: Date.now(),
        });
      } else if (model === 'question') {
        onEvent({ type: 'status_change', status: 'waiting_input', timestamp: Date.now() });
        onEvent({
          type: 'user_input_prompt',
          questions: [
            {
              id: 'q1',
              header: 'Architecture',
              question: 'Which persistence strategy should we adopt for session history?',
              options: [
                { label: 'SQLite WAL (Recommended)', description: 'High performance local store' },
                { label: 'File JSON', description: 'Simple plain files' },
              ],
            },
          ],
          timestamp: Date.now(),
        });
        return;
      }

      await new Promise((r) => setTimeout(r, 400));
      if (stopped) return;

      // 4. Assistant completion
      onEvent({
        type: 'chat_message',
        role: 'assistant',
        content: `I have completed the task for turn #${turnCount}. The tests are green and the code updates have been committed to the working tree.`,
        timestamp: Date.now(),
      });

      // 5. Idle state (triggers auto turn checkpoint)
      onEvent({ type: 'status_change', status: 'idle', timestamp: Date.now() });
    };

    // Trigger initial turn
    void runTurn('Welcome to Baton Replay Mode');

    return {
      write: (input: string) => {
        if (stopped) return;
        void runTurn(input);
      },
      stop: async () => {
        stopped = true;
        this.currentAbort?.();
        if (this.resolveApproval) {
          this.resolveApproval(false);
          this.resolveApproval = null;
        }
        onEvent({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
      },
    };
  }

  async approve(_reason?: string): Promise<void> {
    if (this.resolveApproval) {
      this.resolveApproval(true);
      this.resolveApproval = null;
    }
  }

  async reject(_reason?: string): Promise<void> {
    if (this.resolveApproval) {
      this.resolveApproval(false);
      this.resolveApproval = null;
    }
  }
}
