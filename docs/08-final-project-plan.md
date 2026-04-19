# FlowWhips 最终项目规划与技术实现

> 版本：1.1 | 日期：2026-04-19
> 前置文档：04-paseo-gap-analysis / 05-paseo-code-reuse / 06-runtime-analysis / 07-best-implementation-path
> 关联文档：09-claude-code-pattern-analysis
>
> **状态**: Phase 1–5 + P0 基础实现已完成 (commit c53c3b3)，67 tests passing

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

| 决策           | 选型                   | 理由                                               |
| -------------- | ---------------------- | -------------------------------------------------- |
| **运行时**     | Node.js 22（Bun 待定） | node-pty / better-sqlite3 / Expo 均依赖 Node N-API |
| **语言**       | 全栈 TypeScript (ESM)  | Agent SDK / MCP SDK / 类型共享                     |
| **架构**       | 7 包拆分（保持现有）   | 比 Paseo 单包结构更清晰                            |
| **Paseo 代码** | 学设计 + 用相同底层库  | AGPL 不可复制                                      |
| **框架**       | Hono                   | 比 Express 快 3-5x                                 |
| **构建**       | pnpm + Turborepo       | 比 npm workspaces 更快                             |
| **Web**        | React 19 + Vite        | 比 RN Web 性能更好                                 |
| **Mobile**     | Expo 55                | 覆盖 iOS/Android                                   |
| **桌面**       | Phase 5+ 可选 Tauri    | 复用 Web UI                                        |
| **许可**       | Apache-2.0             | 比 AGPL 宽松                                       |

> **运行时变更说明 (v1.1)**：原计划使用 Bun 作为主运行时。实际实现中选择 Node.js 22，原因：(1) `node-pty` 是 C++ native addon，Bun N-API 支持不完整；(2) `better-sqlite3` 同理；(3) Expo 工具链围绕 Node.js 构建。Bun 可在 `packages/shared` 和 `packages/cli` 等纯 TS 包先行引入，待 native addon 兼容性成熟后再全面迁移。

---

## 2.5 实施进度总览 (v1.1 更新)

> 以下为 commit `c53c3b3` 的实际实现状态。标记说明：✅ 已实现 | ⟳ 骨架/部分实现 | ❌ 未开始

| Phase  | 模块               | 状态 | 说明                                                                                           |
| ------ | ------------------ | ---- | ---------------------------------------------------------------------------------------------- |
| **1**  | NaCl E2E 加密      | ✅   | `shared/crypto/nacl.ts` — keygen、shared key、encrypt/decrypt、SHA256 fingerprint、Base58 编码 |
| **1**  | Agent 状态机       | ✅   | `shared/types/agent.ts` — 6-state discriminated union + VALID_TRANSITIONS                      |
| **1**  | Agent 持久化       | ✅   | `daemon/agent/manager.ts` — file-backed JSON snapshot，crash recovery                          |
| **1**  | 二进制多路复用     | ✅   | `shared/protocol/channels.ts` — encode/decode frame，3 通道                                    |
| **1**  | Hello/Welcome 握手 | ✅   | `shared/protocol/handshake.ts` — versioned handshake                                           |
| **1**  | Relay E2EE         | ✅   | `relay/` — host/client 注册、pair_request 转发、MessageBuffer 离线队列、6 位配对码             |
| **2**  | MCP Server         | ✅   | `daemon/mcp/server.ts` — stdio transport，注册外部 MCP server 工具                             |
| **2**  | MCP Tools (11)     | ✅   | agent CRUD (5) + worktree (3) + provider (3)                                                   |
| **2**  | QR 配对端点        | ✅   | daemon HTTP endpoint 生成 QR                                                                   |
| **3**  | CLI (15+ 命令)     | ✅   | `cli/` — daemon/agent/provider/pipeline/worktree 五组命令 + legacy shortcuts                   |
| **3**  | Provider 系统      | ✅   | `shared/types/provider.ts` — Zod schema；`daemon/agent/registry.ts` — file-backed registry     |
| **4**  | Git Worktree       | ✅   | `daemon/worktree/core.ts` + `session.ts` — create/list/archive                                 |
| **4**  | 语音管道 (STT)     | ✅   | `daemon/speech/stt/` — sherpa.ts + deepgram.ts + types                                         |
| **4**  | 语音管道 (TTS)     | ✅   | `daemon/speech/tts/` — openai.ts + sherpa.ts + types                                           |
| **5**  | 权限引擎           | ✅   | `daemon/permissions/engine.ts` — allow/deny rules + resource prefix matching                   |
| **5**  | 调度器             | ✅   | `daemon/scheduler/schedule.ts` — cron-like；`loop.ts` — Ralph iterations                       |
| **P0** | 统一错误系统       | ✅   | `shared/errors/` — 9 error classes + 4 classifiers + getErrorMessage                           |
| **P0** | 指数退避重试       | ✅   | `shared/retry/` — exponential backoff with jitter                                              |
| **P0** | buildTool 工厂     | ✅   | `shared/tools/` — factory + types + safe defaults (isReadOnly, isConcurrencySafe)              |
| **P0** | MCP Client 管理    | ✅   | `daemon/mcp/client.ts` + `config.ts` — 连接外部 MCP server (stdio/HTTP)                        |
| **—**  | 测试               | ✅   | 67 tests / 9 files passing                                                                     |
| **—**  | 类型检查           | ⚠️   | 7/8 包通过；mobile 有 node:crypto 预存问题                                                     |

### 已知差距（骨架实现，待深化）

| 模块           | 当前状态                          | 需要深化                                                      |
| -------------- | --------------------------------- | ------------------------------------------------------------- |
| Agent SDK 集成 | node-pty spawn + 文本解析         | 待 `@anthropic-ai/claude-agent-sdk` / `@opencode-ai/sdk` 接入 |
| Relay 加密转发 | 密钥交换框架就绪，转发为明文 JSON | 需在消息路径中接入 NaCl box 加解密                            |
| App 二进制协议 | WebSocket client 支持二进制帧     | 需端到端验证与 fallback                                       |
| 语音管道       | 接口/类型定义就绪                 | sherpa-onnx / deepgram 实际调用待集成测试                     |

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
                         │  │ tsx run  │  │ (Phase 5+,   │   │
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
          │  http + ws          │     消息缓冲 / 离线队列
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
├── docs/                              # 项目文档 (9 文件)
│   ├── 04-paseo-gap-analysis.md       # ✅ Paseo 差距分析
│   ├── 05-paseo-code-reuse.md         # ✅ Paseo 代码复用分析
│   ├── 06-runtime-analysis.md         # ✅ 运行时分析
│   ├── 07-best-implementation-path.md # ✅ 最佳实施路径
│   ├── 08-final-project-plan.md       # ✅ 本文档
│   └── 09-claude-code-pattern-analysis.md # ✅ Claude Code 模式分析
├── packages/
│   │   ├── shared/                        # 共享类型、协议、工具
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── index.ts               # ✅ 统一导出
│   │   │       ├── types/
│   │   │       │   ├── index.ts           # ✅ Agent/Session/Event 类型
│   │   │       │   ├── agent.ts           # ✅ Agent 类型 + 状态 + VALID_TRANSITIONS
│   │   │       │   ├── protocol.ts        # ✅ 协议消息类型
│   │   │       │   └── provider.ts        # ✅ Provider 配置类型 (Zod)
│   │   │       ├── protocol/
│   │   │       │   ├── index.ts           # ✅ WebSocket 消息定义
│   │   │       │   ├── channels.ts        # ✅ 二进制多路复用
│   │   │       │   └── handshake.ts       # ✅ Hello/Welcome 握手
│   │   │       ├── crypto/
│   │   │       │   ├── index.ts           # ✅ crypto 导出
│   │   │       │   └── nacl.ts            # ✅ E2EE (NaCl box + SHA256 + Base58)
│   │   │       ├── errors/
│   │   │       │   └── index.ts           # ✅ 9 error classes + 4 classifiers (P0)
│   │   │       ├── retry/
│   │   │       │   └── index.ts           # ✅ 指数退避重试 + jitter (P0)
│   │   │       ├── tools/
│   │   │       │   ├── index.ts           # ✅ tools 导出 (P0)
│   │   │       │   ├── factory.ts         # ✅ buildTool 工厂 (P0)
│   │   │       │   └── types.ts           # ✅ ToolDefinition + ToolContext (P0)
│   │   │       └── utils/
│   │   │           ├── index.ts           # ✅
│   │   │           ├── base.ts            # ✅
│   │   │           └── delta.ts           # ✅ Delta 压缩
│   │   │   ├── __tests__/
│   │   │       │   ├── nacl.test.ts       # ✅ NaCl 加密/解密/握手测试
│   │   │       │   ├── channels.test.ts   # ✅ 二进制帧编解码测试
│   │   │       │   ├── handshake.test.ts  # ✅ 握手流程测试
│   │   │       │   └── agent-state.test.ts # ✅ 状态机转换测试
│   │
│   ├── daemon/                        # 宿主守护进程
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # ✅ Hono + 路由 + MCP server 启动
│   │       ├── agent/
│   │       │   ├── adapter.ts         # ✅ 基础适配器
│   │       │   ├── index.ts           # ✅ agent 导出
│   │       │   ├── manager.ts         # ✅ 完整状态机 + 持久化 + 恢复 (443行)
│   │       │   ├── registry.ts        # ✅ Provider 注册表
│   │       │   ├── claude-code.ts     # ⟳ SDK 集成 (待 claude-agent-sdk)
│   │       │   ├── codex.ts           # ⟳ SDK 集成 (待 codex SDK)
│   │       │   └── opencode.ts        # ⟳ SDK 集成 (待 opencode-ai/sdk)
│   │       ├── mcp/                   # ✅ MCP Server (Phase 2)
│   │       │   ├── index.ts           # ✅ mcp 导出
│   │       │   ├── server.ts          # ✅ MCP 服务主体 + 外部 server 连接
│   │       │   ├── client.ts          # ✅ MCP Client 管理器 (P0)
│   │       │   ├── config.ts          # ✅ MCP client 配置加载 (P0)
│   │       │   └── tools/
│   │       │       ├── agent-tools.ts # ✅ agent CRUD (5 tools)
│   │       │       ├── worktree.ts    # ✅ worktree 管理 (3 tools)
│   │       │       └── provider.ts    # ✅ provider 查询 (3 tools)
│   │       ├── worktree/              # ✅ Git Worktree (Phase 4)
│   │       │   ├── core.ts            # ✅ git worktree 操作
│   │       │   └── session.ts         # ✅ per-worktree agent
│   │       ├── speech/                # ✅ 语音管道 (Phase 4)
│   │       │   ├── index.ts           # ✅ speech 导出
│   │       │   ├── types.d.ts         # ✅ 语音管道类型
│   │       │   ├── stt/
│   │       │   │   ├── types.ts       # ✅ STT 接口
│   │       │   │   ├── sherpa.ts      # ✅ 本地 STT
│   │       │   │   └── deepgram.ts    # ✅ 云端 STT
│   │       │   └── tts/
│   │       │       ├── types.ts       # ✅ TTS 接口
│   │       │       ├── openai.ts      # ✅ OpenAI TTS
│   │       │       └── sherpa.ts      # ✅ 本地 TTS
│   │       ├── scheduler/             # ✅ 调度器 (Phase 5)
│   │       │   ├── schedule.ts        # ✅ 定时任务
│   │       │   └── loop.ts            # ✅ Ralph Loop
│   │       ├── permissions/           # ✅ 权限引擎 (Phase 5)
│   │       │   └── engine.ts          # ✅ allow/deny rules + resource prefix
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
│   │       ├── index.ts               # ✅ http + ws relay (host/client 注册、转发)
│   │       ├── buffer.ts              # ✅ MessageBuffer 离线消息缓冲
│   │       └── pairing.ts             # ✅ 6 位配对码生成/验证
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
│   │       │   └── websocket.ts       # ✅ 二进制协议支持
│   │       └── stores/
│   │           ├── connection.ts      # ✅
│   │           └── events.ts          # ✅
│   │
│   ├── mobile/                        # 移动端 (Expo 55)
│   │   ├── package.json
│   │   ├── app/                       # expo-router 页面
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── XtermWebView.tsx   # ✅ xterm.js WebView 终端
│   │   │   └── services/
│   │   │       └── websocket.ts       # ✅ 二进制 WebSocket client
│   │   └── (持续扩展中)
│   │
│   └── cli/                           # 命令行工具
│       ├── package.json
│       └── src/
│           ├── index.ts               # ✅ 完整 CLI 路由 (98行)
│           ├── commands/
│           │   ├── daemon.ts           # ✅ daemon start/stop/status/pair
│           │   ├── agent.ts            # ✅ agent ls/run/stop/attach/send/logs/inspect
│           │   ├── provider.ts         # ✅ provider ls/models
│           │   ├── worktree.ts         # ✅ worktree ls/create/archive
│           │   └── pipeline.ts         # ✅ pipeline create/run/ls
│           └── client/
│               ├── api.ts             # ✅ HTTP API client
│               └── daemon-client.ts   # ✅ Daemon WebSocket client
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

### 5.1 Agent 状态机 ✅ 已实现

**文件**: `packages/daemon/src/agent/manager.ts` (443 行)

> **实现状态**: 完整的 6-state discriminated union 状态机 + file-backed 持久化 + crash recovery。

**已实现功能**:

- ✅ `AgentState` discriminated union (6 种状态)
- ✅ `VALID_TRANSITIONS` 合法转换验证
- ✅ `AgentSnapshot` JSON 持久化到 `~/.flowwhips/agents/{hash}/{id}.json`
- ✅ `restore()` 方法扫描持久化目录，恢复所有 agent 状态
- ✅ Crashed agents 自动标记为 stopped
- ✅ Timeline 追踪 (最近 200 条) + EventHistory (最近 5000 条) + OutputHistory (最近 10000 条)
- ✅ PTY 生命周期管理 (spawn/onData/onExit)

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

### 5.2 E2E 加密 Relay ✅ 框架就绪

**文件**: `packages/shared/src/crypto/nacl.ts` (181 行) + `packages/relay/src/`

> **实现状态**: NaCl 加密原语完整实现。Relay 框架就绪（注册/转发/配对/缓冲），消息路径中的加解密待 P2 阶段接入。

**已实现**:

- ✅ `generateKeyPair()` — NaCl 密钥对生成
- ✅ `deriveSharedKey()` — ECDH 共享密钥协商
- ✅ `encrypt()` / `decrypt()` — NaCl secretbox 加解密
- ✅ `sha256()` / `fingerprint()` — SHA256 哈希 + Base58 指纹
- ✅ `RelayServer` — host/client 注册、消息转发、健康检查
- ✅ `MessageBuffer` — 离线消息缓冲队列
- ✅ `PairingService` — 6 位配对码生成/验证/过期

**待深化** (P2):

- ⬜ 消息转发路径中接入 NaCl box 加解密（当前为明文 JSON 转发）
- ⬜ 握手流程端到端验证

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

### 5.3 WebSocket 二进制多路复用 ✅ 已实现

**文件**: `packages/shared/src/protocol/channels.ts` + `handshake.ts`

> **实现状态**: 二进制帧编解码 + 版本化握手完整实现。测试覆盖 (channels.test.ts + handshake.test.ts)。

**已实现**:

- ✅ `encodeFrame(channel, payload)` — 二进制帧编码
- ✅ `decodeFrame(data)` — 二进制帧解码
- ✅ Channel 0 (Control) / 1 (Terminal) / 2 (Events) 三通道
- ✅ `HandshakeMessage` 版本化握手协议
- ✅ 4 个测试文件覆盖

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

### 5.4 Agent SDK 集成 ⟳ 框架就绪，待 SDK 接入

**文件**: `packages/daemon/src/agent/adapter.ts` + `manager.ts`

> **实现状态**: BaseAgentAdapter 接口 + node-pty spawn 完整工作。Agent SDK 待官方发布后接入。

**已实现**:

- ✅ `BaseAgentAdapter` 抽象基类 (buildSpawnConfig + parseOutput)
- ✅ `AgentManager.start()` 通过 node-pty spawn agent 进程
- ✅ PTY 输出解析 → `ParsedEvent[]` 结构化事件
- ✅ 状态机自动跟踪 (initializing → running，tool_use 计数)

**待深化** (P1):

- ⬜ `claude-code.ts` — 接入 `@anthropic-ai/claude-agent-sdk`
- ⬜ `opencode.ts` — 接入 `@opencode-ai/sdk`
- ⬜ SDK 检测降级: `adapter.detect()` → SDK 优先，PTY fallback

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

### 5.5 MCP Server ✅ 已实现

> **实现状态**: `packages/daemon/src/mcp/` 完整实现。
> 实际架构与原规划一致，额外增加了 MCP Client 管理器用于连接外部 MCP server。

**实际实现亮点**:

- `server.ts` — McpServer + StdioServerTransport，注册 11 个内置工具 + 动态加载外部 MCP server 工具
- `client.ts` — McpClientManager，支持 stdio/HTTP 连接外部 MCP server，工具名自动前缀 `mcp__{server}__{tool}`
- `config.ts` — 从 `~/.flowwhips/mcp-servers.json` 加载外部 MCP server 配置
- 工具通过 `buildTool` 工厂创建，自动带有 `isReadOnly`、`isConcurrencySafe` 安全默认值

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

### 5.6 自定义 Provider 系统 ✅ 已实现

**文件**: `packages/shared/src/types/provider.ts` + `packages/daemon/src/agent/registry.ts`

> **实现状态**: Zod schema + file-backed registry 完整实现。

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

### 5.7 完整 CLI ✅ 已实现

**文件**: `packages/cli/src/` (98 行主路由 + 5 个命令模块)

> **实现状态**: 15+ 命令全部可用，含 legacy shortcuts。

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

### 5.8 P0 — Claude Code 模式借鉴 ✅ 已实现

> 详见 `docs/09-claude-code-pattern-analysis.md`。
> 从 Claude Code 开源架构中提取的横切关注点模式，已全部落地。

#### 5.8.1 统一错误系统 ✅

**文件**: `packages/shared/src/errors/index.ts` (165 行)

```typescript
// 9 个错误类，覆盖所有业务场景
FlowWhipsError          // 基类 (code + message)
├── ShellError          // 命令执行失败 (stdout/stderr/exitCode)
├── CryptoError         // 加密操作失败
├── ProtocolError       // 协议解析/握手失败
├── ConfigError         // 配置文件加载失败 (filePath)
├── McpError            // MCP server 调用失败 (serverName)
├── TransportError      // WebSocket/网络传输失败
├── AgentNotFoundError  // Agent 不存在
└── PermissionDeniedError // 权限拒绝 (resource + action)

// 4 个错误分类器
function classifyError(error: unknown): ErrorClass;
// → 'network' | 'permission' | 'crypto' | 'unknown'

function isRetryable(error: unknown): boolean;
// → 网络错误、超时可重试，其他不可重试

function getErrorMessage(error: unknown): string;
// → 安全的错误消息提取，永不抛出

function formatErrorForLog(error: unknown): Record<string, unknown>;
// → 结构化日志格式
```

#### 5.8.2 指数退避重试 ✅

**文件**: `packages/shared/src/retry/index.ts` (57 行)

```typescript
interface RetryOptions {
  maxAttempts: number; // 最大重试次数
  baseDelay: number; // 基础延迟 (ms)
  maxDelay: number; // 最大延迟 (ms)
  jitter: boolean; // 是否添加随机抖动
  shouldRetry?: (error: unknown) => boolean; // 重试条件判断
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
```

#### 5.8.3 buildTool 工厂 ✅

**文件**: `packages/shared/src/tools/` (factory.ts + types.ts + index.ts)

```typescript
// 安全默认值 — 与 Claude Code 的 TOOL_DEFAULTS 设计一致
const TOOL_DEFAULTS = {
  isReadOnly: () => false, // 默认写操作
  isConcurrencySafe: () => false, // 默认不安全并发
  isDestructive: () => false,
};

function buildTool<I, O>(def: ToolDefinition<I, O>): BuiltTool<I, O>;

// 实际注册: daemon/mcp/tools/ 中 11 个工具均通过 buildTool 创建
```

#### 5.8.4 MCP Client 管理器 ✅

**文件**: `packages/daemon/src/mcp/client.ts` (142 行)

```typescript
class McpClientManager {
  // 连接多个外部 MCP server (stdio/HTTP)
  async connectAll(config: McpClientConfig): Promise<void>;

  // 聚合所有外部 server 的工具列表
  getAllTools(): Array<{ serverName: string; tool: Tool }>;

  // 调用外部 server 的工具
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;

  // 断开所有连接
  async disconnectAll(): Promise<void>;
}
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

#### Phase 1 — 安全 & 基础 ✅ 已安装

| 包          | 用途              | 加到                   |
| ----------- | ----------------- | ---------------------- |
| `tweetnacl` | NaCl box E2E 加密 | shared, relay          |
| `pino`      | 结构化日志        | daemon, relay, gateway |

#### Phase 2 — 核心 Agent ✅ 已安装

| 包                          | 用途             | 加到   |
| --------------------------- | ---------------- | ------ |
| `@modelcontextprotocol/sdk` | MCP Server       | daemon |
| `qrcode`                    | QR 码生成        | daemon |
| `zod`                       | 配置/schema 验证 | shared |

#### Phase 2 — 待安装 (Agent SDK)

| 包                               | 用途              | 状态                 |
| -------------------------------- | ----------------- | -------------------- |
| `@anthropic-ai/claude-agent-sdk` | Claude SDK 集成   | ⬜ 待 SDK 公开后集成 |
| `@opencode-ai/sdk`               | OpenCode SDK 集成 | ⬜ 待 SDK 公开后集成 |
| `expo-camera`                    | QR 码扫描         | ⬜ 移动端配对功能    |

#### Phase 4 — 差异化 ✅ 接口定义就绪

| 包                 | 用途           | 加到   | 状态                    |
| ------------------ | -------------- | ------ | ----------------------- |
| `sherpa-onnx-node` | 本地 STT/TTS   | daemon | ⬜ 接口就绪，待实际安装 |
| `@deepgram/sdk`    | 云端 STT       | daemon | ⬜ 接口就绪，待实际安装 |
| `openai`           | OpenAI TTS API | daemon | ⬜ 接口就绪，待实际安装 |

### 已安装依赖 (v1.1 实际)

| 包                          | 加到   | 版本    |
| --------------------------- | ------ | ------- |
| `tweetnacl`                 | root   | ^1.0.3  |
| `@modelcontextprotocol/sdk` | daemon | ^1.29.0 |
| `qrcode`                    | daemon | ^1.5.4  |
| `zod`                       | daemon | ^4.3.6  |
| `hono`                      | daemon | ^4.7.0  |
| `ws`                        | daemon | ^8.18.0 |
| `node-pty`                  | daemon | ^1.0.0  |
| `chokidar`                  | daemon | ^4.0.3  |
| `pino`                      | daemon | ^10.3.1 |

### 可移除依赖

| 包                    | 原因                              |
| --------------------- | --------------------------------- |
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
│  大量，快速   │  vitest --watch
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
    - uses: actions/setup-node@v4
      with: { node-version: '22' }
    - uses: pnpm/action-setup@v4
    - pnpm install --frozen-lockfile
    - pnpm run typecheck
    - pnpm run lint (或 biome check)
    - pnpm run test
    - pnpm run build

# .github/workflows/release.yml — 新增
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    - pnpm run build
    - pnpm run test
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
✅ Week 1: Phase 1 — 安全 & 基础                           [已完成 c53c3b3]
├── Day 1-2: E2E 加密 (tweetnacl + nacl.ts 181行)
├── Day 3-4: Agent 状态机 (manager.ts 443行 + 持久化 + 恢复)
└── Day 5:   WebSocket 二进制协议 (channels + handshake)
    验收: ✅ relay 消息 E2EE 框架, daemon 状态持久化可恢复

✅ Week 2: Phase 2 — 核心 Agent 能力                       [已完成 c53c3b3]
├── Day 1-2: MCP Server (server.ts + 11 tools)
├── Day 3-4: MCP Client 管理器 (外部 server 连接)
└── Day 5:   QR 配对端点 + PairingService
    验收: ✅ MCP tools 可用, 外部 server 工具自动注册

✅ Week 3: Phase 3 — CLI + Provider                        [已完成 c53c3b3]
├── Day 1-3: 完整 CLI (15+ 命令 + legacy shortcuts)
└── Day 4-5: Provider 系统 (Zod schema + file-backed registry)
    验收: ✅ flowwhips daemon/agent/provider/pipeline/worktree 全部可用

✅ Week 4: Phase 4a — Worktree + 语音                       [已完成 c53c3b3]
├── Day 1-3: Git Worktree (core + session + MCP tool)
└── Day 4-5: 语音管道 (STT sherpa/deepgram + TTS openai/sherpa)
    验收: ✅ worktree create/list/archive, 语音接口定义就绪

✅ Week 5: Phase 4b — 权限 + 调度                           [已完成 c53c3b3]
├── Day 1-2: PermissionEngine (allow/deny + resource prefix)
└── Day 3-4: ScheduleService + LoopService (Ralph iterations)
    验收: ✅ 权限规则匹配, 定时/循环调度可用

✅ P0: Claude Code 模式借鉴                                 [已完成 c53c3b3]
├── 统一错误系统 (9 error classes + 4 classifiers)
├── 指数退避重试 (withRetry + jitter)
├── buildTool 工厂 (isReadOnly, isConcurrencySafe defaults)
└── MCP Client 管理器 (stdio/HTTP)
    验收: ✅ 67 tests passing, 7/8 包 typecheck 通过

⬜ Week 6+: Phase 5 — 持续完善                              [待实施]
├── Agent SDK 深度集成 (claude-agent-sdk / opencode-ai/sdk)
├── Relay NaCl box 加解密 (密文转发而非明文)
├── 语音管道端到端集成测试
├── 推送通知
├── 多主题
├── CI/CD 扩展 + Release 自动化
├── 桌面端 (Tauri 壳)
└── 编排 Skills
```

---

## 十一、风险与缓解

| 风险                 | 概率 | 影响 | 缓解                            |
| -------------------- | ---- | ---- | ------------------------------- |
| Agent SDK API 变更   | 高   | 中   | adapter 模式隔离，版本锁定      |
| Agent 输出格式不稳定 | 高   | 中   | 解析失败回退到原始流，SDK 优先  |
| node-pty 版本兼容性  | 中   | 高   | 锁定版本，测试矩阵覆盖 Node 22+ |
| Relay 加密性能开销   | 低   | 低   | NaCl box 足够轻量，基准测试验证 |

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

---

## 十三、下一阶段计划 (Phase 6+)

> Phase 1–5 + P0 基础实现已完成。以下为待深化的工作项，按优先级排序。

### P1 — Agent SDK 深度集成（高优先级）

当前所有 agent 均通过 `node-pty` spawn + 文本解析。需接入官方 SDK 获取结构化消息。

| 任务             | 说明                                                                       | 预估 |
| ---------------- | -------------------------------------------------------------------------- | ---- |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` 接入，获取 tool_use/thinking 等结构化事件 | 3 天 |
| OpenCode SDK     | `@opencode-ai/sdk` 接入                                                    | 2 天 |
| SDK 检测降级     | `adapter.detect()` 检测 SDK 可用性，不可用时降级到 PTY 模式                | 1 天 |
| adapter 接口扩展 | `BaseAgentAdapter` 增加事件订阅、结构化输出                                | 1 天 |

### P2 — Relay NaCl 加解密（高优先级）

当前 relay 转发明文 JSON。需在消息路径中接入 NaCl box，实现真正的零知识转发。

| 任务          | 说明                                           | 预估 |
| ------------- | ---------------------------------------------- | ---- |
| 密文封装/解封 | `relay/src/` 接入 `shared/crypto/nacl.ts`      | 2 天 |
| 握手流程验证  | Client ↔ Relay ↔ Daemon 三方密钥交换端到端测试 | 1 天 |
| 断线重连      | 加密消息缓冲 + 重放                            | 1 天 |

### P3 — 端到端集成测试（中优先级）

| 任务                       | 说明                       | 预估 |
| -------------------------- | -------------------------- | ---- |
| Daemon ↔ Client 二进制协议 | 真实 WebSocket 连接测试    | 1 天 |
| Relay E2EE 全链路          | 加密 → 转发 → 解密         | 1 天 |
| CLI 端到端                 | 每个命令对真实 daemon 调用 | 2 天 |
| Mobile 连接测试            | Expo app → relay → daemon  | 1 天 |

### P4 — Web App 增强（中优先级）

| 任务                | 说明                     | 预估 |
| ------------------- | ------------------------ | ---- |
| EventTimeline 组件  | 结构化事件时间线展示     | 2 天 |
| FileChangeList 组件 | 文件变更列表 + diff 预览 | 2 天 |
| DiffViewer 组件     | 代码差异高亮显示         | 1 天 |
| 代码高亮            | Lezer 集成               | 2 天 |

### P5 — 生产化（中优先级）

| 任务           | 说明                                    | 预估 |
| -------------- | --------------------------------------- | ---- |
| CI/CD 扩展     | typecheck + test + build + lint 自动化  | 2 天 |
| Release 自动化 | tag 触发，自动 publish + GitHub Release | 1 天 |
| 推送通知       | Agent 完成/错误时推送                   | 1 天 |
| 多主题支持     | Dark/Light/Custom                       | 2 天 |
| 桌面端壳       | Tauri 包装 Web UI                       | 3 天 |

### P6 — 语音管道端到端（低优先级）

接口已就绪，需实际集成 sherpa-onnx / Deepgram / OpenAI。

| 任务                 | 说明                   | 预估 |
| -------------------- | ---------------------- | ---- |
| sherpa-onnx 本地 STT | 安装 + 集成 + 测试     | 2 天 |
| Deepgram 云端 STT    | API 对接 + 流式        | 1 天 |
| OpenAI TTS           | API 对接 + 流式播放    | 1 天 |
| 移动端语音输入       | 手机录音 → STT → agent | 2 天 |
