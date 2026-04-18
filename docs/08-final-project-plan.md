# FlowWhips 最终项目规划与技术实现

> 版本：1.0 | 日期：2026-04-18
> 前置文档：04-paseo-gap-analysis / 05-paseo-code-reuse / 06-runtime-analysis / 07-best-implementation-path

---

## 一、项目定位与目标

### 一句话定位

> **开源 AI Agent 远程编排平台 — 从任何设备控制 Claude Code / Codex / OpenCode，结构化理解 Agent 行为。**

### 与 Paseo 的核心差异

```
Paseo:     远程终端 → 看到 Agent 的字符输出
FlowWhips: 智能控制面板 → 理解 Agent 行为，结构化展示，MCP 编排
```

### 关键目标

| 时间     | 目标                                    |
| -------- | --------------------------------------- |
| Week 1-2 | 安全基础就绪（E2EE + 状态机 + WS 协议） |
| Week 3   | 核心 Agent 能力（SDK + MCP + QR 配对）  |
| Week 4   | CLI + Provider 系统完整                 |
| Week 5-6 | 差异化功能（语音 + Worktree + 高亮）    |
| Week 7+  | 持续完善（权限/调度/CI/桌面端）         |

---

## 二、技术决策总览

| 决策           | 选型                  | 理由                           |
| -------------- | --------------------- | ------------------------------ |
| **运行时**     | Bun（Node.js 兜底）   | 启动快 5x、测试快 3x、原生 TS  |
| **语言**       | 全栈 TypeScript       | Agent SDK / MCP SDK / 类型共享 |
| **架构**       | 7 包拆分（保持现有）  | 比 Paseo 单包结构更清晰        |
| **Paseo 代码** | 学设计 + 用相同底层库 | AGPL 不可复制                  |
| **框架**       | Hono                  | 比 Express 快 3-5x             |
| **构建**       | pnpm + Turborepo      | 比 npm workspaces 更快         |
| **Web**        | React 19 + Vite       | 比 RN Web 性能更好             |
| **Mobile**     | Expo 55               | 覆盖 iOS/Android               |
| **桌面**       | Phase 5+ 可选 Tauri   | 复用 Web UI                    |
| **许可**       | Apache-2.0            | 比 AGPL 宽松                   |

---

## 三、系统架构

### 3.1 整体架构图

```
                         ┌───────────────────────────────────┐
                         │         客户端层 (Clients)          │
                         │                                    │
                         │  ┌──────────┐  ┌──────────────┐   │
                         │  │ Web App  │  │ Mobile App   │   │
                         │  │ React 19 │  │ Expo (iOS/   │   │
                         │  │ + Vite   │  │ Android)     │   │
                         │  └────┬─────┘  └──────┬───────┘   │
                         │       │               │           │
                         │  ┌────┴─────┐  ┌──────┴───────┐   │
                         │  │   CLI    │  │ Desktop App  │   │
                         │  │ bun run  │  │ (Phase 5+,   │   │
                         │  └────┬─────┘  │  Tauri可选)  │   │
                         │       │        └──────┬───────┘   │
                         └───────┼───────────────┼───────────┘
                                 │               │
                    ┌────────────┴───────────────┘
                    │
              E2E Encrypted (NaCl)
                    │
         ┌──────────▼──────────┐
         │      Relay          │     公网中继 (NAT穿透)
         │  Bun.serve() + ws   │     消息缓冲 / 离线队列
         │  NaCl box 零知识     │     QR 码配对
         └──────────┬──────────┘
                    │ E2EE
         ┌──────────▼──────────────────────────────────┐
         │              Daemon                          │
         │  ┌─────────────────────────────────────┐    │
         │  │  HTTP (Hono, port 3210)              │    │
         │  │  ├── REST API (agents/files/pipes)   │    │
         │  │  └── MCP Server (工具暴露给 Agent)    │    │
         │  ├─────────────────────────────────────┤    │
         │  │  WebSocket (port 3211)               │    │
         │  │  ├── 二进制多路复用                    │    │
         │  │  │   ch0 = control                   │    │
         │  │  │   ch1 = terminal                  │    │
         │  │  │   ch2 = events                    │    │
         │  │  └── Hello/Welcome 握手              │    │
         │  ├─────────────────────────────────────┤    │
         │  │  Agent Manager                       │    │
         │  │  ├── 状态机                           │    │
         │  │  │   starting→running→idle→error     │    │
         │  │  │            →stopped               │    │
         │  │  ├── SDK 集成                         │    │
         │  │  │   claude-agent-sdk                │    │
         │  │  │   opencode-ai/sdk                 │    │
         │  │  ├── Worktree 管理                    │    │
         │  │  └── 输出解析器                       │    │
         │  ├─────────────────────────────────────┤    │
         │  │  语音管道 (Phase 4)                   │    │
         │  │  ├── STT: sherpa-onnx / Deepgram     │    │
         │  │  └── TTS: OpenAI / sherpa-onnx       │    │
         │  ├─────────────────────────────────────┤    │
         │  │  调度器 (Phase 5)                     │    │
         │  │  ├── Schedule Service                │    │
         │  │  └── Loop Service (Ralph)            │    │
         │  └─────────────────────────────────────┘    │
         │                                              │
         │  ┌──────┐  ┌─────────┐  ┌───────────────┐  │
         │  │ PTY  │  │ Watcher │  │ Permission    │  │
         │  │ node │  │ chokidar│  │ Engine        │  │
         │  │ -pty │  │         │  │ allow/deny    │  │
         │  └──┬───┘  └─────────┘  └───────────────┘  │
         │     │                                         │
         │     ▼                                         │
         │  ┌─────────────────────────┐                 │
         │  │  Agent 进程             │                 │
         │  │  Claude Code | Codex    │                 │
         │  │  OpenCode | Custom      │                 │
         │  └─────────────────────────┘                 │
         └──────────────────────────────────────────────┘
                    │
                    ▼ SQLite
         ┌──────────────────────────────────────────────┐
         │              Gateway (port 3220)              │
         │  JWT Auth + 6位码/QR配对 + Host注册           │
         │  Drizzle ORM + SQLite                        │
         └──────────────────────────────────────────────┘
```

### 3.2 包依赖关系

```
                    shared
                   ↗   |   ↖
              daemon  gateway  relay
                ↗        ↗       ↗
             cli      app     mobile
```

### 3.3 数据流

```
用户输入 "fix the bug"
    │
    ▼ CLI / Web / Mobile
    │ WebSocket ClientMessage
    │ { type: "terminal_input", sessionId, data }
    │
    ▼ Daemon Transport (WS Server)
    │
    ▼ AgentManager.write(id, data)
    │
    ▼ node-pty → Agent CLI 进程
    │
    │  Agent 输出 (raw text)
    ▼
    │ AgentAdapter.parseOutput(raw)
    │ → ParsedEvent[] (结构化)
    │
    ▼ Transport → 广播给订阅的客户端
    │ DaemonMessage:
    │   { type: "terminal_output", ... }  ← 原始流
    │   { type: "parsed_event", event }   ← 结构化事件
    │
    ▼ 客户端渲染
    │   xterm.js ← terminal_output
    │   EventTimeline ← parsed_event
    │   FileChangeList ← file_change 事件
```

---

## 四、Monorepo 最终结构

```
FlowWhips/
├── docs/                              # 项目文档 (7+ 文件)
├── packages/
│   ├── shared/                        # 共享类型、协议、工具
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # 统一导出
│   │       ├── types/
│   │       │   ├── index.ts           # ✅ Agent/Session/Event 类型
│   │       │   ├── agent.ts           # Agent 类型 + 状态
│   │       │   ├── protocol.ts        # 协议消息类型
│   │       │   └── provider.ts        # + Provider 配置类型
│   │       ├── protocol/
│   │       │   ├── index.ts           # ✅ WebSocket 消息定义
│   │       │   ├── channels.ts        # + 二进制多路复用
│   │       │   └── handshake.ts       # + Hello/Welcome 握手
│   │       ├── crypto/
│   │       │   ├── aes.ts             # ← 从 daemon 提升
│   │       │   └── nacl.ts            # + E2EE (NaCl box)
│   │       └── utils/
│   │           ├── index.ts           # ✅
│   │           ├── base.ts            # ✅
│   │           └── delta.ts           # ✅ Delta 压缩
│   │
│   ├── daemon/                        # 宿主守护进程
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # ✅ Hono + 路由
│   │       ├── agent/
│   │       │   ├── adapter.ts         # ✅ 基础适配器
│   │       │   ├── manager.ts         # ⟳ 完整状态机
│   │       │   ├── claude-code.ts     # ⟳ SDK 集成
│   │       │   ├── codex.ts           # ⟳ SDK 集成
│   │       │   └── opencode.ts        # ⟳ SDK 集成
│   │       ├── mcp/                   # + MCP Server
│   │       │   ├── server.ts          # MCP 服务主体
│   │       │   └── tools/
│   │       │       ├── agent-tools.ts # agent CRUD
│   │       │       ├── worktree.ts    # worktree 管理
│   │       │       └── provider.ts    # provider 查询
│   │       ├── worktree/              # + Git Worktree
│   │       │   ├── core.ts            # git worktree 操作
│   │       │   └── session.ts         # per-worktree agent
│   │       ├── speech/                # + 语音管道 (Phase 4)
│   │       │   ├── stt/
│   │       │   │   ├── sherpa.ts      # 本地 STT
│   │       │   │   └── deepgram.ts    # 云端 STT
│   │       │   └── tts/
│   │       │       ├── openai.ts      # OpenAI TTS
│   │       │       └── sherpa.ts      # 本地 TTS
│   │       ├── scheduler/             # + 调度器 (Phase 5)
│   │       │   ├── schedule.ts        # 定时任务
│   │       │   └── loop.ts            # Ralph Loop
│   │       ├── permissions/           # + 权限引擎 (Phase 5)
│   │       │   └── engine.ts          # allow/deny rules
│   │       ├── parser/
│   │       │   ├── index.ts           # ✅ Claude Code 解析
│   │       │   └── ansi.ts            # ✅ ANSI 剥离
│   │       ├── transport/
│   │       │   ├── index.ts           # ⟳ 二进制多路复用
│   │       │   └── relay.ts           # ⟳ E2EE 连接
│   │       ├── watcher/
│   │       │   └── index.ts           # ✅ chokidar
│   │       └── __tests__/
│   │           ├── manager.test.ts
│   │           ├── parser.test.ts
│   │           ├── mcp.test.ts
│   │           └── worktree.test.ts
│   │
│   ├── relay/                         # WebSocket 中继
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # ⟳ Bun.serve + E2EE
│   │       ├── crypto.ts              # + NaCl box 转发
│   │       ├── buffer.ts              # + 消息缓冲
│   │       └── pairing.ts             # + 配对协议
│   │
│   ├── gateway/                       # API 网关 + 认证
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # ✅ Hono 路由
│   │       ├── services/
│   │       │   └── auth.ts            # ⟳ JWT + QR 配对
│   │       └── db/
│   │           ├── index.ts           # ✅ Drizzle SQLite
│   │           ├── schema.ts          # ✅ 数据库 schema
│   │           └── migrations/
│   │               └── 0001_init.sql  # ✅
│   │
│   ├── app/                           # Web 客户端
│   │   ├── package.json
│   │   └── src/
│   │       ├── App.tsx                # ✅ 主布局
│   │       ├── main.tsx               # ✅ 入口
│   │       ├── screens/
│   │       │   ├── Dashboard.tsx      # ✅ Agent 列表
│   │       │   ├── Terminal.tsx       # ✅ xterm.js
│   │       │   ├── Files.tsx          # ✅ 文件浏览
│   │       │   ├── Pipelines.tsx      # ✅ Pipeline
│   │       │   ├── AgentDetail.tsx    # ✅ Agent 详情
│   │       │   └── Settings.tsx       # ✅ 设置
│   │       ├── components/            # + 拆分组件
│   │       │   ├── agent/
│   │       │   │   ├── EventTimeline.tsx
│   │       │   │   ├── FileChangeList.tsx
│   │       │   │   └── AgentStatus.tsx
│   │       │   ├── terminal/
│   │       │   │   └── TerminalToolbar.tsx
│   │       │   └── diff/
│   │       │       └── DiffViewer.tsx
│   │       ├── services/
│   │       │   └── websocket.ts       # ✅ → ⟳ 二进制协议
│   │       └── stores/
│   │           ├── connection.ts      # ✅
│   │           └── events.ts          # ✅
│   │
│   ├── mobile/                        # 移动端 (Expo)
│   │   ├── package.json
│   │   └── (保持现有结构，扩展功能)
│   │
│   └── cli/                           # 命令行工具
│       ├── package.json
│       └── src/
│           ├── index.ts               # ⟳ 完整 CLI
│           ├── commands/
│           │   ├── daemon.ts           # daemon start/stop/status
│           │   ├── agent.ts            # agent ls/run/stop/attach/send
│           │   ├── provider.ts         # provider ls/models
│           │   ├── worktree.ts         # worktree ls/create/archive
│           │   └── pipeline.ts         # pipeline create/run/ls
│           └── client/
│               └── daemon-client.ts    # Daemon WebSocket client
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── vitest.config.ts
└── .github/
    └── workflows/
        ├── ci.yml                     # ✅ → 扩展
        ├── release.yml                # + Release
        └── deploy-relay.yml           # + Relay 部署
```

---

## 五、核心模块技术实现

### 5.1 Agent 状态机

**文件**: `packages/daemon/src/agent/manager.ts`

**当前问题**: 无完整状态机，`setTimeout` 500ms 猜测 agent 已启动，无持久化。

**目标实现**:

```typescript
// Agent 状态 — discriminated union
type AgentState =
  | { status: 'initializing'; at: number }
  | { status: 'idle'; at: number; lastActivity: number }
  | { status: 'running'; at: number; toolCount: number }
  | { status: 'waiting_input'; at: number; prompt: string }
  | { status: 'error'; at: number; error: string; code?: number }
  | { status: 'stopped'; at: number; exitCode: number };

// 状态转换 — 合法路径
const VALID_TRANSITIONS: Record<string, string[]> = {
  initializing: ['idle', 'error', 'stopped'],
  idle: ['running', 'waiting_input', 'error', 'stopped'],
  running: ['idle', 'waiting_input', 'error', 'stopped'],
  waiting_input: ['running', 'idle', 'error', 'stopped'],
  error: ['stopped'],
  stopped: [],
};

// 持久化 — file-backed JSON
// $FLOWWHIPS_HOME/agents/{cwd-hash}/{agent-id}.json
interface AgentSnapshot {
  id: string;
  type: AgentType;
  projectPath: string;
  state: AgentState;
  timeline: TimelineItem[]; // 最近 200 条
  createdAt: string;
}
```

**变更范围**: `manager.ts` 重写，`shared/src/types/index.ts` 扩展 AgentState 类型。

### 5.2 E2E 加密 Relay

**文件**: `packages/relay/src/` 重写

**当前问题**: 纯 WebSocket 转发，零加密。

**目标实现**:

```typescript
// shared/src/crypto/nacl.ts
import nacl from 'tweetnacl';

// 密钥对生成
function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };

// ECDH 共享密钥协商
function deriveSharedKey(peerPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array;

// 加密消息
function encrypt(plaintext: Uint8Array, nonce: Uint8Array, sharedKey: Uint8Array): Uint8Array;

// 解密消息
function decrypt(ciphertext: Uint8Array, nonce: Uint8Array, sharedKey: Uint8Array): Uint8Array;

// relay/src/crypto.ts — Relay 端只转发密文
// relay 看不到明文 — 零知识设计
```

**新增依赖**: `tweetnacl`

**握手流程**:

```
1. Daemon 启动 → 生成密钥对 (pkD, skD)
2. QR 码包含: daemonId + pkD fingerprint + relay URL
3. Client 扫码 → 生成密钥对 (pkC, skC)
4. Client → Relay: { type: "hello", publicKey: pkC, targetDaemon: daemonId }
5. Relay → Daemon: { type: "client_hello", publicKey: pkC }
6. Daemon 计算: sharedKey = nacl.box.before(pkC, skD)
7. Daemon → Relay → Client: nacl.box.encrypt(welcomeMsg, nonce, pkC, skD)
8. Client 验证 → 计算: sharedKey = nacl.box.before(pkD, skC)
9. 后续所有消息: nacl.box.encrypt(payload, counterNonce, sharedKey)
```

### 5.3 WebSocket 二进制多路复用

**文件**: `packages/shared/src/protocol/channels.ts` + `packages/daemon/src/transport/index.ts`

**当前问题**: 纯文本 JSON，无通道分离。

**目标实现**:

```typescript
// 二进制帧格式:
// [1 byte channel] [8 bytes timestamp] [N bytes payload]
//
// Channel 0: Control (JSON) — hello/welcome/subscribe/unsubscribe
// Channel 1: Terminal (raw bytes) — xterm.js 数据流
// Channel 2: Events (JSON) — ParsedEvent 结构化事件

// 编码
function encodeFrame(channel: Channel, payload: Uint8Array): Uint8Array;

// 解码
function decodeFrame(data: Uint8Array): {
  channel: Channel;
  timestamp: number;
  payload: Uint8Array;
};

// 握手
// Client → Daemon: { type: "hello", version: 1, channels: [0,1,2] }
// Daemon → Client: { type: "welcome", sessionId, agents: [...] }
```

**变更范围**: shared 新增 channels.ts + handshake.ts，daemon transport 重写，app/mobile websocket 适配。

### 5.4 Agent SDK 集成

**文件**: `packages/daemon/src/agent/claude-code.ts` 等

**当前问题**: 裸 node-pty spawn，只能拿到原始文本，需要自己 parse。

**目标实现**:

```typescript
// claude-code.ts — 使用 Claude Agent SDK
import { ClaudeAgentClient } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  async start(config: AgentConfig): Promise<AgentHandle> {
    const client = new ClaudeAgentClient({
      cwd: config.projectPath,
      // SDK 提供结构化消息而非原始文本
    });

    // SDK 事件: tool_use, thinking, text_output, status_change
    client.on("tool_use", (event) => { ... });
    client.on("thinking", (event) => { ... });
    client.on("status_change", (status) => { ... });

    return { client, processId: client.pid };
  }
}

// 保留 node-pty 作为 fallback — 某些 agent 可能没有 SDK
// adapter.detect() 检测 SDK 可用性，不可用时降级到 PTY 模式
```

**新增依赖**: `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk`

**变更范围**: 各 adapter 文件重写，`BaseAgentAdapter` 接口扩展。

### 5.5 MCP Server

**文件**: `packages/daemon/src/mcp/` (新增)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'flowwhips-daemon',
  version: '0.1.0',
});

// Agent 管理工具
server.tool(
  'agent_create',
  'Start a new coding agent',
  {
    provider: z.enum(['claude-code', 'codex', 'opencode']),
    projectPath: z.string(),
    prompt: z.string().optional(),
    worktree: z.boolean().default(false),
  },
  async (params) => {
    const sessionId = await agentManager.start(params);
    return { content: [{ type: 'text', text: JSON.stringify({ sessionId, status: 'running' }) }] };
  },
);

server.tool('agent_list', 'List all running agents', {}, async () => {
  return { content: [{ type: 'text', text: JSON.stringify(agentManager.list()) }] };
});

server.tool(
  'agent_stop',
  'Stop a running agent',
  {
    sessionId: z.string(),
  },
  async ({ sessionId }) => {
    await agentManager.stop(sessionId);
    return { content: [{ type: 'text', text: 'Agent stopped' }] };
  },
);

server.tool(
  'agent_send',
  'Send a message to an agent',
  {
    sessionId: z.string(),
    message: z.string(),
  },
  async ({ sessionId, message }) => {
    agentManager.write(sessionId, message + '\n');
    return { content: [{ type: 'text', text: 'Message sent' }] };
  },
);

// Worktree 工具
server.tool(
  'worktree_create',
  'Create a git worktree',
  {
    basePath: z.string(),
    branch: z.string(),
  },
  async (params) => {
    const wt = await worktreeManager.create(params);
    return { content: [{ type: 'text', text: JSON.stringify(wt) }] };
  },
);

// 启动 MCP Server (stdio transport — 给 Agent CLI 使用)
const transport = new StdioServerTransport();
server.connect(transport);
```

**新增依赖**: `@modelcontextprotocol/sdk`

**变更范围**: daemon 新增 `src/mcp/` 目录，`index.ts` 启动 MCP server。

### 5.6 自定义 Provider 系统

**文件**: `packages/shared/src/types/provider.ts` + `packages/daemon/src/agent/registry.ts`

```typescript
// ~/.flowwhips/providers.json
// shared/src/types/provider.ts — Zod schema
const ProviderProfileSchema = z.object({
  type: z.enum(['claude-code', 'codex', 'opencode', 'custom']),
  binary: z.string().optional(), // 自定义二进制路径
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  models: z.array(z.string()).optional(),
  profiles: z
    .record(
      z.object({
        model: z.string().optional(),
        args: z.array(z.string()).default([]),
        env: z.record(z.string()).default({}),
      }),
    )
    .default({}),
});

const ProviderConfigSchema = z.object({
  providers: z.record(ProviderProfileSchema),
});

type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// 示例配置:
// {
//   "providers": {
//     "claude-opus": {
//       "type": "claude-code",
//       "profiles": {
//         "default": { "model": "opus-4" },
//         "sonnet": { "model": "sonnet-4" }
//       }
//     },
//     "qwen": {
//       "type": "custom",
//       "binary": "/usr/local/bin/qwen-coder",
//       "models": ["qwen-max", "qwen-plus"]
//     }
//   }
// }
```

**新增依赖**: `zod`

### 5.7 完整 CLI

**文件**: `packages/cli/src/` 重写

```bash
# Daemon 管理
flowwhips daemon start [--port 3210] [--foreground]
flowwhips daemon stop
flowwhips daemon status
flowwhips daemon pair              # 显示 QR 码

# Agent 管理
flowwhips agent ls [-a] [-g]       # 列出 agent (-a 全部含已停止, -g 全局)
flowwhips agent run <project> [--provider claude-code] [--prompt "..."]
flowwhips agent stop <sessionId>
flowwhips agent attach <sessionId> # 流式输出
flowwhips agent send <sessionId> "message"
flowwhips agent logs <sessionId>   # 历史日志
flowwhips agent inspect <sessionId> # 详细信息

# Provider 管理
flowwhips provider ls
flowwhips provider models <provider>

# Worktree 管理
flowwhips worktree ls
flowwhips worktree create <basePath> --branch <name>
flowwhips worktree archive <path>

# Pipeline 管理
flowwhips pipeline create --name "review-fix" --steps '...'
flowwhips pipeline run <pipelineId>
flowwhips pipeline ls
```

---

## 六、数据库 Schema

**保持现有 schema，扩展以支持新功能**:

```sql
-- 现有表 (保持不变)
-- hosts, sessions, session_logs, file_changes, users

-- + 新增: Provider 配置
CREATE TABLE provider_configs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,    -- "claude-opus", "qwen"
  type        TEXT NOT NULL,           -- claude-code | codex | opencode | custom
  config      TEXT NOT NULL,           -- JSON (binary, args, env, models, profiles)
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- + 新增: Worktree 记录
CREATE TABLE worktrees (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  base_path   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- + 新增: 权限规则
CREATE TABLE permissions (
  id          TEXT PRIMARY KEY,
  agent_type  TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  rule        TEXT NOT NULL CHECK (rule IN ('allow', 'deny')),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- + 新增: 调度任务
CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cron        TEXT,                    -- cron 表达式
  provider    TEXT NOT NULL,
  project_path TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  last_run    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## 七、关键依赖清单

### 新增依赖（按 Phase 排序）

#### Phase 1 — 安全 & 基础

| 包            | 用途              | 加到                            |
| ------------- | ----------------- | ------------------------------- |
| `tweetnacl`   | NaCl box E2E 加密 | shared, relay                   |
| `pino`        | 结构化日志        | daemon, relay, gateway          |
| `pino-pretty` | 开发日志格式化    | daemon, relay, gateway (devDep) |

#### Phase 2 — 核心 Agent

| 包                               | 用途              | 加到   |
| -------------------------------- | ----------------- | ------ |
| `@anthropic-ai/claude-agent-sdk` | Claude SDK 集成   | daemon |
| `@opencode-ai/sdk`               | OpenCode SDK 集成 | daemon |
| `@modelcontextprotocol/sdk`      | MCP Server        | daemon |
| `qrcode`                         | QR 码生成         | daemon |
| `expo-camera`                    | QR 码扫描         | mobile |
| `zod`                            | 配置/schema 验证  | shared |

#### Phase 4 — 差异化

| 包                 | 用途           | 加到   |
| ------------------ | -------------- | ------ |
| `sherpa-onnx-node` | 本地 STT/TTS   | daemon |
| `@deepgram/sdk`    | 云端 STT       | daemon |
| `openai`           | OpenAI TTS API | daemon |

### 可移除依赖

| 包                    | 原因                              |
| --------------------- | --------------------------------- |
| `tsx` (devDep)        | Bun 原生 TS                       |
| `vitest` (devDep)     | `bun test` 替代 (Phase 3+)        |
| `@hono/node-server`   | Bun 原生 HTTP (验证后)            |
| `eslint` + `prettier` | 可选替换为 `biome` (Paseo 的选择) |

---

## 八、测试策略

### 测试分层

```
                  ┌──────────────┐
                  │  E2E Tests   │  Playwright (Web) + 手动 (Mobile)
                  │  少量，关键路径 │
                  ├──────────────┤
                  │ Integration  │  Agent SDK + WebSocket + Relay
                  │  中等数量     │  真实依赖，不 mock
                  ├──────────────┤
                  │  Unit Tests  │  状态机 / 解析器 / 加密 / 工具函数
                  │  大量，快速   │  bun test --watch
                  └──────────────┘
```

### 测试覆盖目标

| 包      | 单元测试    | 集成测试    | E2E           |
| ------- | ----------- | ----------- | ------------- |
| shared  | ✅ 必须     | —           | —             |
| daemon  | ✅ 必须     | ✅ 必须     | —             |
| relay   | ✅ 必须     | ✅ 加密握手 | —             |
| gateway | ✅ 必须     | —           | —             |
| app     | —           | —           | ✅ Playwright |
| mobile  | —           | —           | 手动          |
| cli     | ✅ 命令解析 | —           | —             |

### 关键测试用例

```typescript
// daemon/__tests__/manager.test.ts
describe('AgentManager 状态机', () => {
  test('initializing → running → idle → stopped');
  test('非法转换抛出错误: stopped → running');
  test('持久化到文件: agent snapshot 可恢复');
  test('重启后恢复所有 agent 状态');
});

// shared/__tests__/nacl.test.ts
describe('E2E 加密', () => {
  test('加密→解密: 原文一致');
  test('不同 nonce 加密结果不同');
  test('错误密钥解密失败');
  test('握手流程: 双方协商出相同共享密钥');
});

// relay/__tests__/relay.test.ts
describe('Relay E2EE 转发', () => {
  test('host → client: 密文转发，relay 无法解密');
  test('断线重连: 缓冲消息重放');
  test('配对码过期: 超时拒绝');
});
```

---

## 九、CI/CD 管道

### GitHub Actions Workflows

```yaml
# .github/workflows/ci.yml — 扩展现有
name: CI
on: [push, pull_request]
jobs:
  check:
    - bun install
    - bun run typecheck
    - bun run lint (或 biome check)
    - bun test
    - bun run build

# .github/workflows/release.yml — 新增
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    - bun run build
    - bun test
    - npm publish (各包)
    - gh release create

# .github/workflows/deploy-relay.yml — 新增
name: Deploy Relay
on:
  push:
    branches: [main]
    paths: ['packages/relay/**']
```

---

## 十、实施时间线

```
Week 1: Phase 1 — 安全 & 基础
├── Day 1-2: E2E 加密 (tweetnacl + relay 重写)
├── Day 3-4: Agent 状态机 (manager 重写 + 持久化)
└── Day 5:   WebSocket 二进制协议 (channels + handshake)
    验收: relay 消息全加密, daemon 状态持久化可恢复

Week 2: Phase 2 — 核心 Agent 能力
├── Day 1-2: Agent SDK 集成 (claude-agent-sdk + opencode-ai/sdk)
├── Day 3-4: MCP Server (tools: agent CRUD + worktree)
└── Day 5:   QR 码配对 (qrcode + expo-camera)
    验收: SDK 结构化消息, MCP tools 可用, QR 扫码配对

Week 3: Phase 3 — CLI + Provider
├── Day 1-3: 完整 CLI (15+ 命令)
└── Day 4-5: Provider 系统 (Zod schema + registry)
    验收: flowwhips daemon start / agent run / provider ls 全部可用

Week 4: Phase 4a — Worktree + 高亮
├── Day 1-3: Git Worktree (core + session + MCP tool)
└── Day 4-5: 代码高亮 (Lezer 集成)
    验收: worktree create → agent 在隔离分支运行

Week 5: Phase 4b — 语音 + 桌面
├── Day 1-3: 语音管道 (STT sherpa + TTS openai)
└── Day 4-5: 桌面端可选 (Tauri 壳 / Bun compile)
    验收: 手机语音输入 → agent 接收指令

Week 6+: Phase 5 — 持续完善
├── Agent 权限系统 (2天)
├── 定时任务 / Ralph Loop (2天)
├── 推送通知 (1天)
├── 多主题 (2天)
├── CI/CD 扩展 (3天)
├── Release 自动化 (2天)
└── 编排 Skills (3天)
```

---

## 十一、风险与缓解

| 风险                     | 概率 | 影响 | 缓解                              |
| ------------------------ | ---- | ---- | --------------------------------- |
| node-pty 在 Bun 上不稳定 | 中   | 高   | 保持 Node.js fallback，混合运行时 |
| Agent SDK API 变更       | 高   | 中   | adapter 模式隔离，版本锁定        |
| Agent 输出格式不稳定     | 高   | 中   | 解析失败回退到原始流，SDK 优先    |
| E2EE 握手实现复杂        | 低   | 中   | 严格参照 Paseo 设计 + NaCl box    |
| Bun 生产环境不够稳定     | 低   | 高   | 渐进式迁移，Node.js 保底          |

---

## 十二、成功指标

| Phase            | 指标                                                  |
| ---------------- | ----------------------------------------------------- |
| **Phase 1 完成** | relay 全部消息 E2E 加密，daemon 重启后恢复 agent 状态 |
| **Phase 2 完成** | 通过 MCP Server 控制 agent，QR 码配对 10 秒内完成     |
| **Phase 3 完成** | CLI 覆盖 15+ 命令，支持自定义 Provider                |
| **Phase 4 完成** | Worktree 隔离运行，语音输入可用                       |
| **Phase 5 完成** | CI 全自动化，Release 一键发布                         |

### 长期目标

| 时间    | 目标                                  |
| ------- | ------------------------------------- |
| 3 个月  | 功能覆盖 Paseo 80%                    |
| 6 个月  | GitHub Star 500+，社区贡献            |
| 12 个月 | 成为 Agent 编排的 Apache-2.0 标准选择 |
