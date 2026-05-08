# 对话式开发控制系统设计

> 日期：2026-04-27
> 版本：v1.0
> 参考：Remodex (phodex.app), Claude Code (extends/open-claude-code)

---

## 一、设计目标

将 Baton 从"终端模拟器 + 事件监控"模式升级为 **Remodex 风格的对话式开发控制**，支持：

1. **对话式交互**：用户 → AI 多轮对话，而非终端输入
2. **运行中 Steering**：在 agent 执行过程中实时发送新提示
3. **任务排队**：一个任务未完成时，排队后续提示
4. **模式切换**：Fast Mode / Plan Mode / Default Mode
5. **中断/取消**：中断当前 tool 执行
6. **Git 集成**：从 UI 完成提交、推送等操作

---

## 二、前提条件分析

### 2.1 Agent 能力矩阵

| 能力 | Claude Code | Codex | OpenCode |
|------|-------------|-------|----------|
| **运行中插话** | ✅ `prependUserMessage()` | ✅ JSON-RPC `turn/steer` | ❌ CLI 不支持 |
| **任务排队** | ✅ prepend 队列 | ✅ `turn/queue` | ❌ |
| **Fast Mode** | ✅ `/fast` | ✅ Fast mode | ❌ |
| **Plan Mode** | ✅ `/plan` | ✅ Plan mode | ❌ |
| **中断当前** | ✅ ESC | ✅ `turn/interrupt` | ❌ |
| **Git 操作** | ✅ 内置 | ✅ 内置 | ❌ |
| **实现方式** | PTY + SDK 协议 | PTY + JSON-RPC | PTY |

**结论**：Claude Code 和 Codex 支持 Steering，OpenCode 暂不支持。设计应优先覆盖前两者。

### 2.2 Claude Code 的 `prependUserMessage` 机制

```typescript
// extends/open-claude-code/src/cli/structuredIO.ts
class StructuredIO {
  private prependedLines: string[] = [];

  // 在运行过程中动态注入用户消息
  prependUserMessage(content: string): void {
    this.prependedLines.push(JSON.stringify({
      type: 'user',
      session_id: '',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    }) + '\n');
  }

  // 读取循环：prependedLines 优先于 stdin
  private async *read() {
    for (;;) {
      if (this.prependedLines.length > 0) {
        content = this.prependedLines.join('') + content;
        this.prependedLines = [];
      }
      // 处理 stdin 输入...
      yield* splitIntoLines();
    }
  }
}
```

### 2.3 Codex 的 Steering 机制

```javascript
// codex app-server JSON-RPC
{
  "jsonrpc": "2.0",
  "method": "turn/steer",    // 运行中插话
  "params": {
    "turnId": "turn_xxx",
    "content": [...],
    "mode": "fast",           // fast | plan | default
    "parentTurnId": null
  }
}
```

### 2.4 Baton 现有基础

```typescript
// 现有输入流：Web App → WebSocket → Transport → AgentManager.write() → PTY
write(id: string, data: string): void {
  managed.pty.write(data);  // 直接写入 PTY stdin
}
```

---

## 三、架构改造设计

### 3.1 协议层扩展（packages/shared/src/protocol/）

```typescript
// 新增消息类型
interface SteerInputMessage {
  type: 'steer_input';
  sessionId: string;
  content: string;
  mode: 'steer' | 'queue';     // 立即插话 vs 排队
  turnMode?: 'default' | 'fast' | 'plan';  // 执行模式
}

interface CancelTurnMessage {
  type: 'cancel_turn';
  sessionId: string;
  turnId?: string;
}

interface GitCommandMessage {
  type: 'git_command';
  sessionId: string;
  method: string;               // status, commit, push, pull, branches...
  params: Record<string, unknown>;
}

// 更新 ClientMessage 联合类型
type ClientMessage =
  | TerminalInputMessage
  | SteerInputMessage      // 新增
  | CancelTurnMessage      // 新增
  | GitCommandMessage      // 新增
  | ControlMessage;

// 新增回合状态消息
interface TurnStatusMessage {
  type: 'turn_status';
  sessionId: string;
  id: string;                     // turn ID
  status: 'started' | 'thinking' | 'executing' | 'waiting_input' | 'completed' | 'cancelled';
  queueCount: number;             // 排队中任务数
}
```

### 3.2 AgentManager 改造（packages/daemon/src/agent/manager.ts）

```typescript
interface ManagedAgent {
  // ... 现有字段 ...

  // 新增：消息队列
  inputQueue: QueuedMessage[];
  activeTurnId: string | null;
  currentMode: 'default' | 'fast' | 'plan';
}

interface QueuedMessage {
  id: string;
  content: string;
  mode: 'steer' | 'queue';
  turnMode: 'default' | 'fast' | 'plan';
  timestamp: number;
}

class AgentManager {
  // 新增方法：steering 输入
  steer(agentId: string, input: SteerInputMessage): void {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);

    const queued: QueuedMessage = {
      id: generateId(),
      content: input.content,
      mode: input.mode,
      turnMode: input.turnMode ?? 'default',
      timestamp: Date.now(),
    };

    if (input.mode === 'queue') {
      // 排队模式：放入队列，等当前任务完成
      managed.inputQueue.push(queued);
      this.notifyQueueUpdate(agentId);
      return;
    }

    // steer 模式：立即注入
    managed.inputQueue.push(queued);
    this.injectMessage(managed, queued);
  }

  // 新增方法：消息注入
  private injectMessage(managed: ManagedAgent, msg: QueuedMessage): void {
    const adapter = managed.adapter;

    if (adapter?.agentType === 'claude-code') {
      // Claude Code: 使用 StructuredIO.prependUserMessage
      this.claudeInject(managed, msg);
    } else if (adapter?.agentType === 'codex') {
      // Codex: 发送 JSON-RPC turn/steer
      this.codexInject(managed, msg);
    }
    // OpenCode: 暂不支持
  }

  // Claude Code 注入
  private claudeInject(managed: ManagedAgent, msg: QueuedMessage): void {
    if (!managed.pty) return;

    const payload = JSON.stringify({
      type: 'user',
      session_id: '',
      message: {
        role: 'user',
        content: this.buildTurnContent(msg),
      },
      parent_tool_use_id: null,
    }) + '\n';

    managed.pty.write(payload);
    this.transition(managed.process.id, 'running');
    this.pushTimeline(managed, 'steer', `Steer: ${msg.content.slice(0, 50)}`);
  }

  // Codex 注入
  private codexInject(managed: ManagedAgent, msg: QueuedMessage): void {
    if (!managed.pty) return;

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/steer',
      params: {
        turnId: msg.id,
        content: [{ type: 'text', text: msg.content }],
        mode: msg.turnMode,
      },
    }) + '\n';

    managed.pty.write(payload);
  }

  // 内部方法：构建包含模式上下文的提示
  private buildTurnContent(msg: QueuedMessage): string {
    const modeHints: Record<string, string> = {
      fast: '\n[Mode: Fast - 优先速度]',
      plan: '\n[Mode: Plan - 先规划后执行，不要修改文件]',
      default: '',
    };
    const hint = modeHints[msg.turnMode] ?? '';
    return hint ? `${msg.content}${hint}` : msg.content;
  }

  // 新增方法：取消回合
  cancelTurn(agentId: string, turnId?: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);

    // 清除排队消息
    if (turnId) {
      managed.inputQueue = managed.inputQueue.filter(q => q.id !== turnId);
    } else {
      managed.inputQueue = [];
    }

    // 发送中断信号
    // Claude Code: 发送 ESC (\x1b) 或 SIGINT
    // Codex: 发送 turn/cancel JSON-RPC
    managed.pty?.write('\x03');  // SIGINT
    this.transition(agentId, 'idle');
  }

  // 新增方法：队列状态通知
  private notifyQueueUpdate(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    const msg: TurnStatusMessage = {
      type: 'turn_status',
      sessionId: agentId,
      id: managed.activeTurnId || '',
      status: managed.state.status as any,
      queueCount: managed.inputQueue.length,
    };

    for (const cb of managed.eventCallbacks) {
      cb(msg as any, agentId);
    }
  }
}
```

### 3.3 Transport 层改造（packages/daemon/src/transport/index.ts）

```typescript
private handleMessage(clientId: string, msg: ClientMessage): void {
  switch (msg.type) {
    case 'terminal_input': {
      this.agentManager.write(msg.sessionId, msg.data);
      break;
    }
    // 新增
    case 'steer_input': {
      this.agentManager.steer(msg.sessionId, msg);
      break;
    }
    case 'cancel_turn': {
      this.agentManager.cancelTurn(msg.sessionId, msg.turnId);
      break;
    }
    case 'git_command': {
      this.handleGitCommand(msg);
      break;
    }
    case 'control':
      this.handleControl(clientId, msg);
      break;
  }
}

// Git 命令处理
private async handleGitCommand(msg: GitCommandMessage): Promise<void> {
  const result = await this.executeGitMethod(msg.method, msg.params);
  this.broadcast({
    type: 'git_result',
    sessionId: msg.sessionId,
    method: msg.method,
    result,
  });
}
```

### 3.4 Git Handler 实现（packages/daemon/src/git/handler.ts）

```typescript
// 新增 Git 处理模块，借鉴 Remodex git-handler.js

export class GitHandler {
  async handleMethod(method: string, params: Record<string, unknown>, cwd: string) {
    switch (method) {
      case 'status':    return this.gitStatus(cwd);
      case 'diff':      return this.gitDiff(cwd);
      case 'commit':    return this.gitCommit(cwd, params);
      case 'push':      return this.gitPush(cwd);
      case 'pull':      return this.gitPull(cwd);
      case 'branches':  return this.gitBranches(cwd);
      case 'checkout':  return this.gitCheckout(cwd, params);
      case 'createBranch': return this.gitCreateBranch(cwd, params);
      case 'stash':     return this.gitStash(cwd);
      case 'stashPop':  return this.gitStashPop(cwd);
      case 'log':       return this.gitLog(cwd);
      case 'remoteUrl': return this.gitRemoteUrl(cwd);
    }
  }

  private async gitStatus(cwd: string) {
    const result = await execFile('git', ['status', '--porcelain=v1', '-b'], { cwd });
    return parseGitStatus(result);
  }

  private async gitCommit(cwd: string, params: Record<string, unknown>) {
    const message = params.message as string || 'Changes from Baton';
    await execFile('git', ['add', '-A'], { cwd });
    const result = await execFile('git', ['commit', '-m', message], { cwd });
    return parseGitCommitOutput(result);
  }

  // ... 其余方法
}
```

---

## 四、UI 层设计

### 4.1 Web 端对话组件（packages/app/src/components/chat/）

```
components/chat/
├── ChatView.tsx          # 对话主视图
├── ChatMessage.tsx       # 单条消息组件
├── ChatInput.tsx         # 输入框组件
├── ChatTurnBanner.tsx    # Turn 状态横幅
├── ChatToolUse.tsx       # Tool use 卡片
├── ChatFileChange.tsx    # 文件变更卡片
├── ChatThinking.tsx      # 思考过程（可折叠）
├── ChatDiffPreview.tsx   # Diff 预览
├── ChatModeSelector.tsx  # 模式选择器
└── ChatQueueIndicator.tsx # 排队指示器
```

### 4.2 对话消息数据结构

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  turnId?: string;
  blocks: ContentBlock[];
}

type ContentBlock =
  | TextBlock           // { type: 'text', text: string }
  | ThinkingBlock       // { type: 'thinking', content: string, collapsed: boolean }
  | ToolUseBlock        // { type: 'tool_use', tool: string, args: object, status: 'running'|'done'|'error' }
  | ToolResultBlock     // { type: 'tool_result', stdout?: string, stderr?: string }
  | FileChangeBlock     // { type: 'file_change', path: string, diff?: string }
  | CommandExecBlock    // { type: 'command_exec', command: string, exitCode?: number }
  | StatusBannerBlock   // { type: 'status', status: string, queueCount: number }
```

### 4.3 输入框组件（ChatInput）

```typescript
interface ChatInputProps {
  agentId: string;
  disabled: boolean;
  placeholder?: string;
}

// 功能：
// - Enter → 立即发送 (steer 模式)
// - Shift+Enter → 排队 (queue 模式)
// - @ 可引用文件
// - 模式选择下拉菜单 (Default / Fast / Plan)
// - 显示排队数量徽章
```

### 4.4 与现有 Terminal 视图的整合

```
方案 A：Tab 切换
┌─────────────────────────────────────────┐
│ [对话] [终端] [文件] [事件] ...         │
├─────────────────────────────────────────┤
│ ChatView | TerminalView | FileBrowser  │
│ ...                                     │
└─────────────────────────────────────────┘

方案 B：混合视图（推荐）
┌─────────────────────────────────────────┐
│ ChatView (对话)                         │
│ ├── Message 1 (user)                   │
│ ├── Message 2 (assistant + tool_use)   │
│ ├── Message 3 (user, steer)            │  ← 运行中插话
│ └── ChatInput [Enter=发送 Shift+Enter=排队] │
├─────────────────────────────────────────┤
│ TerminalView (可折叠的终端面板)          │
│ └── 原始 PTY 输出                       │
└─────────────────────────────────────────┘
```

---

## 五、实施计划

### 阶段 1：最小可行对话（2-3天）

**目标**：Web 端可用对话式交互（单个 agent）

```typescript
// 任务拆解

// 1.1 协议扩展（0.5天）
- shared/protocol: 新增 SteerInputMessage, CancelTurnMessage
- shared/types: 新增 ChatMessage, ContentBlock 类型

// 1.2 Manager 改造（0.5天）
- daemon/agent/manager: 新增 steer(), cancelTurn(), injectMessage()
- 支持 Claude Code 的 prependUserMessage 方式

// 1.3 Transport 改造（0.5天）
- daemon/transport: 处理 steer_input, cancel_turn 消息类型

// 1.4 Web UI 对话组件（1天）
- ChatView, ChatMessage, ChatInput
- 连接到现有 WebSocket 服务
- Enter 发送 steer_input, Shift+Enter 发送 queue 模式
```

### 阶段 2：丰富交互（2天）

**目标**：Tool use 可视化、mode 切换、queue 可视化

```typescript
// 2.1 Tool use 卡片（0.5天）
- ChatToolUse: 显示工具调用的输入/输出
- ChatFileChange: 显示文件变更 + diff 预览
- ChatThinking: 折叠/展开思考过程

// 2.2 Mode 选择器（0.5天）
- ChatModeSelector: Default/Fast/Plan 下拉菜单
- 将选择传递到 steerInput.turnMode

// 2.3 Queue 可视化（0.5天）
- ChatQueueIndicator: 排队数量 + 可查看/取消
- ChatTurnBanner: Turn 状态横幅（运行中/完成/取消）

// 2.4 Mix 视图（0.5天）
- 可折叠的底部终端面板
- 对话视图和终端视图数据同步
```

### 阶段 3：Git 集成（2天）

**目标**：对话中完成 Git 操作

```typescript
// 3.1 Git Handler（1天）
- packages/daemon/src/git/handler.ts
- 支持: status, diff, commit, push, pull, branches, checkout, stash, log

// 3.2 Git UI 组件（0.5天）
- ChatGitStatus: 仓库状态预览
- ChatGitCommitFlow: 提交流程（选择文件 → 写消息 → 提交通知）

// 3.3 AI Git 消息生成（0.5天）
- git/generateCommitMessage: 用 AI 生成提交消息
```

### 阶段 4：Codex 支持（1天）

**目标**：Codex agent 也支持对话式控制

```typescript
// 4.1 Codex 适配器扩展（0.5天）
- codexInject(): 使用 JSON-RPC turn/steer
- 模式映射: fast → Fast mode, plan → Plan mode

// 4.2 统一接口（0.5天）
- Manager 自动选择注入方式（根据 agent type）
```

### 阶段 5：安全增强（可选，1-2天）

**目标**：借鉴 Remodex 的安全模型

```typescript
// 5.1 设备身份 + QR 配对
- 生成 Ed25519 设备密钥对
- QR 码携带 relay session 信息
- 信任关系持久化

// 5.2 E2E 加密升级
- 在现有 NaCl 基础上增加:
  - 单调计数器防重放
  - 设备签名验证
```

---

## 六、关键代码路径

### 6.1 用户发送对话消息的完整路径

```
ChatInput.jsx
  └─ wsService.send({ type: 'steer_input', ... })
      └─ WebSocket → Transport.handleMessage()
          └─ AgentManager.steer(agentId, input)
              ├─ mode='queue' → inputQueue.push() + notify
              └─ mode='steer' → injectMessage()
                  └─ adapter.agentType === 'claude-code'
                      └─ managed.pty.write(JSON.stringify(SDKUserMessage))
                          └─ PTY → Claude Code stdin
                              └─ Processed mid-turn as prepended message
```

### 6.2 Agent 返回对话消息的完整路径

```
Claude Code stdout
  └─ PTY onData → Manager.parseOutput()
      └─ adapter.parseOutput(raw) → ParsedEvent[]
          └─ structuredIO.parseEventForChat(event) → ChatContentBlock[]
              └─ broadcast({ type: 'steer_response', ... })
                  └─ WebSocket → Web App
                      └─ ChatView 更新消息列表
```

---

## 七、技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Claude Code SDK 协议变化 | Steering 不可用 | 同时支持 PTY 原始模式回退 |
| OpenCode 不支持 steering | 无法支持 | 初期只支持 Claude Code + Codex |
| PTY 写入时机不确定 | 消息丢失或乱序 | 增加 ACK 机制 |
| 大量排队消息导致内存增长 | 性能问题 | 限制队列大小 + LRU 清理 |

---

## 八、与现有 Terminal 视图的关系

**不是替代，而是增强**：

- 现有 TerminalView 保留，用于底层调试
- ChatView 是新的首选交互方式
- WebSocket 连接可同时服务两个视图
- `terminal_input` 和 `steer_input` 分别路由
