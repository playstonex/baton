# FlowWhips vs Paseo 差距分析

> 分析日期：2026-04-18
> Paseo 版本：0.1.60-rc.1 | FlowWhips 版本：0.0.1

---

## 一、规模对比

| 指标             | FlowWhips  | Paseo                                       |
| ---------------- | ---------- | ------------------------------------------- |
| **版本**         | `0.0.1`    | `0.1.60-rc.1`                               |
| **包数量**       | 7          | 8                                           |
| **总代码量**     | ~6,300 LOC | ~680,000+ LOC                               |
| **文档**         | 3 个文件   | 17 个文件                                   |
| **CI Workflows** | 1 (基础)   | 10 (全自动化)                               |
| **构建脚本**     | 0          | 14                                          |
| **编排技能**     | 0          | 6 (handoff/loop/orchestrate/chat/committee) |
| **许可证**       | Apache-2.0 | AGPL-3.0                                    |

---

## 二、包级对比

### 对应关系

| FlowWhips          | Paseo                | 差距                                          |
| ------------------ | -------------------- | --------------------------------------------- |
| `shared`           | (内置在 server/app)  | FlowWhips 有独立 shared 包，更清晰            |
| `daemon`           | `server`             | **巨大差距**                                  |
| `relay`            | `relay`              | **巨大差距** — 无 E2EE                        |
| `gateway`          | (内置在 server)      | FlowWhips 独立拆分，Paseo 合并到 server       |
| `app` (React+Vite) | `app` (Expo)         | **巨大差距**                                  |
| `cli`              | `cli`                | **巨大差距**                                  |
| `mobile` (Expo)    | `app` (同一包)       | Paseo 用同一个 Expo 包覆盖 web+native+desktop |
| —                  | `desktop` (Electron) | **FlowWhips 无对应**                          |
| —                  | `expo-two-way-audio` | **FlowWhips 无对应**                          |
| —                  | `highlight` (Lezer)  | **FlowWhips 无对应**                          |
| —                  | `website`            | **FlowWhips 无对应**                          |

### 各包详情

#### shared (~323 LOC)

```
src/
├── index.ts              # 主导出
├── types/index.ts        # Agent 类型、Session 类型、ParsedEvent
├── protocol/index.ts     # WebSocket 消息协议
├── utils/
│   ├── base.ts           # 基础工具
│   └── delta.ts          # Delta 压缩
└── __tests__/delta.test.ts
```

#### daemon (~2,020 LOC)

```
src/
├── index.ts              # 主入口 (267 LOC)
├── agent/
│   ├── adapter.ts       # 基础适配器接口
│   ├── manager.ts       # Agent 生命周期管理
│   ├── claude-code.ts   # Claude Code 适配器
│   ├── codex.ts         # Codex 适配器
│   └── opencode.ts      # OpenCode 适配器
├── parser/
│   ├── index.ts         # Claude Code 输出解析器
│   └── ansi.ts          # ANSI 剥离
├── transport/
│   ├── index.ts         # 本地/Relay 传输
│   └── relay.ts         # Relay 连接客户端
├── watcher/
│   └── index.ts         # 文件系统监控 (chokidar)
├── crypto/
│   └── index.ts         # AES-256-GCM 加密
├── orchestrator/
│   └── index.ts         # Pipeline 编排
└── __tests__/
    ├── parser.test.ts
    ├── adapters.test.ts
    ├── orchestrator.test.ts
    └── crypto.test.ts
```

#### relay (~288 LOC)

```
src/
└── index.ts  # 单文件 Relay 服务器
```

- 无加密 — 纯 WebSocket 转发
- 无 Redis 持久化 — 仅内存缓冲
- 无消息压缩

#### gateway (~341 LOC)

```
src/
├── index.ts              # Hono 服务器 + 路由
├── services/auth.ts      # JWT + 6 位数字配对码
└── db/
    ├── index.ts          # Drizzle SQLite 设置
    ├── schema.ts         # 数据库 schema
    └── migrations/0001_init.sql
```

#### app (~1,825 LOC)

```
src/
├── main.tsx              # 入口
├── App.tsx               # 主布局 + 导航
├── screens/
│   ├── Dashboard.tsx     # Agent 列表 + 启动/停止
│   ├── Terminal.tsx      # xterm.js 终端
│   ├── Files.tsx         # 文件浏览器
│   ├── Pipelines.tsx     # Pipeline 编排 UI
│   ├── AgentDetail.tsx   # Agent 详情视图
│   └── Settings.tsx      # 连接设置
├── services/
│   └── websocket.ts      # WebSocket 客户端
└── stores/
    ├── connection.ts     # 连接状态
    └── events.ts         # 事件 store
```

#### cli (~189 LOC)

单文件 CLI，仅支持 start/ls/attach/send/stop 5 个命令。

#### mobile (~1,335 LOC)

完整 Expo 应用，支持远程/本地模式、安全存储、Tab 导航、Agent 管理。

---

## 三、关键功能差距

### 🔴 严重（核心功能缺失）

| #   | 功能                  | Paseo 现状                                                                     | FlowWhips 现状                  |
| --- | --------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| 1   | **E2E 加密中继**      | NaCl box (XSalsa20-Poly1305) + ECDH 密钥交换，relay 零知识                     | 无加密 — 纯 WebSocket 转发      |
| 2   | **MCP Server**        | ~1800 行完整实现，支持 create/list/stop agent、run prompt、worktree 管理       | 零代码 — 文档中提到但完全没实现 |
| 3   | **语音管道**          | STT (Deepgram + Sherpa 本地) + TTS (OpenAI + Sherpa 本地) + 双向实时音频       | 零代码                          |
| 4   | **Git Worktree 支持** | worktree-core + worktree-session + MCP worktree 工具                           | 零代码                          |
| 5   | **Agent 状态机**      | `initializing → idle → running → idle (or error → closed)` + 持久化 + timeline | 基础 manager，无完整状态机      |
| 6   | **QR 码配对**         | QR 生成 + expo-camera 扫描 + ECDH 公钥交换                                     | JWT + 6 位数字配对码（无 QR）   |

### 🟠 重要（差异化功能缺失）

| #   | 功能                     | Paseo 现状                                                                            | FlowWhips 现状                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------- |
| 7   | **桌面应用 (Electron)**  | 完整 Electron 包装，自动启动 daemon，原生文件对话框，自动更新                         | 无                                    |
| 8   | **完整 CLI**             | 30+ 子命令 (agent/daemon/provider/worktree/permit/chat/schedule/loop/speech/terminal) | 5 个基础命令                          |
| 9   | **自定义 Provider 系统** | Z.AI、Qwen、ACP agents (Gemini/Hermes)、自定义 binary、多 profile                     | 仅内置 Claude Code / Codex / OpenCode |
| 10  | **代码高亮 (highlight)** | Lezer 语法高亮包，支持 14 种语言                                                      | 无                                    |
| 11  | **多主题**               | 6 个主题 (light/dark/darkZinc/darkMidnight/darkClaude/darkGhostty)                    | 单主题                                |
| 12  | **推送通知**             | expo-notifications + use-push-token-registration                                      | 无                                    |
| 13  | **编排技能系统**         | handoff / loop / orchestrate / chat / committee — agent 间协作                        | 无                                    |
| 14  | **定时任务 & 循环**      | schedule service + loop service (Ralph-style retry)                                   | pipeline 概念存在但极简               |
| 15  | **Agent 权限系统**       | permit allow/deny/ls — 控制 agent 工具调用权限                                        | 无                                    |

### 🟡 中等（完善度差距）

| #   | 功能               | Paseo 现状                                                                         | FlowWhips 现状                 |
| --- | ------------------ | ---------------------------------------------------------------------------------- | ------------------------------ |
| 16  | **文档深度**       | 17 个文档：ARCHITECTURE/CODING_STANDARDS/TESTING/SECURITY/RELEASE 等               | 3 个文档                       |
| 17  | **测试覆盖**       | server 有 unit + integration + e2e 测试，app 有 Playwright e2e                     | 仅 daemon 和 shared 有基础测试 |
| 18  | **CI/CD**          | 10 个 workflow                                                                     | 1 个基础 CI                    |
| 19  | **Release 自动化** | RC 流程 + 版本同步 + npm publish + git tag + changelog 自动同步                    | 无                             |
| 20  | **Nix 支持**       | flake.nix + NixOS module，4 平台构建                                               | 无                             |
| 21  | **WebSocket 协议** | 二进制多路复用 (channel 0=控制, 1=terminal)，Hello/Welcome 握手                    | 纯文本 JSON，无多路复用        |
| 22  | **Agent SDK 集成** | `@anthropic-ai/claude-agent-sdk` + `@opencode-ai/sdk` + `@agentclientprotocol/sdk` | 直接 node-pty spawn，无 SDK    |
| 23  | **Agent 输出解析** | highlight 包 + 工具调用解析器 + structured events                                  | 基础 ANSI 解析 + regex         |
| 24  | **跨平台 UI 策略** | 单一 Expo 包 → iOS/Android/Web/Electron，.web.ts/.native.ts 分离                   | 3 个独立包                     |

---

## 四、架构差异

```
Paseo 架构:
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐
│ iOS App  │  │Android  │  │  Web    │  │ Desktop  │  ← 同一 Expo 包
│ (Expo)   │  │ (Expo)  │  │ (Expo)  │  │(Electron)│
└────┬─────┘  └────┬────┘  └────┬────┘  └─────┬────┘
     └──────────────┴───────────┴──────────────┘
                           │
                    E2E Encrypted Relay (NaCl)
                           │
                    ┌──────▼──────┐
                    │   Server    │ ← MCP Server + Voice + Worktree + Scheduling
                    │  (port 6767)│
                    └─────────────┘

FlowWhips 架构:
┌─────────┐  ┌──────────┐
│ Web App  │  │  Mobile  │  ← 独立包
│ (React)  │  │  (Expo)  │
└────┬─────┘  └────┬─────┘
     └──────────────┘        ← Plain WebSocket (NO E2EE)
            │
     ┌──────▼──────┐
     │   Gateway   │ ← 独立认证服务 (JWT)
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │   Relay     │ ← 无加密转发
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │   Daemon    │ ← 基础 agent 管理
     └─────────────┘
```

**关键架构差异：**

- Paseo: 扁平 — server 包含 gateway + daemon 功能，app 一个包覆盖所有平台
- FlowWhips: 拆分 — gateway/daemon/relay 各自独立，app/mobile 分开（更清晰）

---

## 五、FlowWhips 的优势

| 优势                  | 详情                                                  |
| --------------------- | ----------------------------------------------------- |
| **独立 shared 包**    | 类型/协议/utils 独立，Paseo 是内联的                  |
| **Apache-2.0 许可证** | 比 AGPL-3.0 更宽松，商业友好                          |
| **pnpm + Turborepo**  | 比 Paseo 的 npm workspaces 更快                       |
| **React 19 + Vite**   | Web 端用纯 React（Paseo 用 RN web，性能可能不如原生） |
| **清晰的包边界**      | daemon/gateway/relay 职责分明                         |
| **Hono 框架**         | 比 Paseo 的 Express 更轻量更快                        |

---

## 六、Paseo 包详情参考

### packages/server — Daemon

**核心特性：**

- Agent 生命周期状态机：`initializing → idle → running → idle (or error → closed)`
- 文件持久化：`$PASEO_HOME/agents/{cwd-with-dashes}/{agent-id}.json`
- WebSocket 二进制多路复用（channel 0=控制, 1=terminal）
- MCP Server (~1800 行)：create/list/stop agent、run prompt、manage worktrees
- 语音：STT (Deepgram, Sherpa 本地) + TTS (OpenAI, Sherpa 本地)
- Git Worktree 管理
- QR 码配对 + ECDH 密钥交换
- 定时任务 + Ralph Loop
- Agent 权限系统 (permit allow/deny)
- 日志：pino + pino-pretty

**关键依赖：**

```
@anthropic-ai/claude-agent-sdk  — Claude SDK
@opencode-ai/sdk               — OpenCode SDK
@agentclientprotocol/sdk        — ACP 协议
@modelcontextprotocol/sdk       — MCP SDK
sherpa-onnx-node                — 本地 STT/TTS
@deepgram/sdk                   — 云端 STT
qrcode                          — QR 码生成
tweetnacl (via relay)           — E2E 加密
pino                            — 日志
```

### packages/app — Expo 客户端

**核心特性：**

- 单包覆盖 iOS/Android/Web/Electron
- 语音：dictation hooks + voice panel + 双向实时音频
- QR 码扫描 (expo-camera)
- xterm.js WebGL 终端
- 文件浏览器
- Agent 权限审批 UI
- 6 个主题
- 推送通知 (expo-notifications)
- react-native-unistyles 样式
- .web.ts / .native.ts 平台分离

### packages/cli

**30+ 子命令：**

```
paseo agent ls/run/stop/logs/inspect/wait/send/attach/update/delete/archive/reload/mode
paseo daemon start/stop/restart/status/pair
paseo provider ls/models
paseo worktree ls/archive
paseo permit allow/deny/ls
paseo chat create/delete/ls/read/post/wait
paseo schedule create/delete/ls/logs/pause/resume
paseo loop run/stop/ls/inspect/logs
paseo speech (dictation)
paseo terminal ls/capture/kill/send-keys
```

### packages/relay

- ECDH 密钥交换 + NaCl box (XSalsa20-Poly1305) E2E 加密
- Relay 零知识 — 无法读取消息内容
- Cloudflare Workers 适配器

### packages/desktop

- Electron 包装 app
- 自动 spawn daemon 为子进程
- 原生文件对话框、标题栏、通知
- 自动更新

### packages/expo-two-way-audio

- PCM 音频捕获/播放 (16kHz, 16-bit mono)
- 回声消除 (AEC)
- 麦克风模式选择 (iOS)
- 音量级别监控

### packages/highlight

- Lezer 语法高亮
- 支持 14 种语言：JS, TS, Python, Go, Rust, C++, Java, HTML, CSS, JSON, YAML, Markdown, PHP, Elixir, XML

### 文档 (17 个文件)

```
docs/
├── ARCHITECTURE.md           — 系统设计、WebSocket 协议、Agent 生命周期
├── CODING_STANDARDS.md       — 类型规范、错误处理、React 模式
├── TESTING.md                — TDD 工作流、确定性测试
├── DEVELOPMENT.md            — 开发服务器、CLI 参考
├── RELEASE.md                — Release 手册、RC 流程
├── CUSTOM-PROVIDERS.md       — 自定义 Provider 配置
├── PROVIDERS.md              — 添加新 Provider 指南
├── ANDROID.md                — Android 构建、EAS 工作流
├── DESIGN.md                 — 功能设计流程
├── DATA_MODEL.md             — 数据结构
├── SECURITY.md               — 安全模型、E2E 加密
├── UNISTYLES.md              — 样式系统
├── FILE_ICONS.md             — 文件图标映射
├── MOBILE_TESTING.md         — 移动端测试
├── PRODUCT.md                — 产品定位
├── AD-HOC-DAEMON-TESTING.md  — 临时测试
└── plan-approval-normalization.md
```

### 编排技能 (6 个)

```
skills/
├── paseo/              — 基础技能
├── paseo-handoff/      — Agent 间交接
├── paseo-loop/         — 循环验证 (worker + verifier)
├── paseo-orchestrate/  — 团队编排 (planner/impl/reviewer/QA)
├── paseo-chat/         — 聊天室
└── paseo-committee/    — 委员会决策
```
