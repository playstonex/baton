# FlowWhips 技术架构

## 一、系统总览

```
┌─────────────────────────────────────────────────────┐
│                   客户端层 (Clients)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Web App  │  │ iOS App  │  │Android App│          │
│  │ (React)  │  │ (Expo)   │  │ (Expo)   │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
└───────┼──────────────┼──────────────┼───────────────┘
        │              │              │
        └──────────────┴──────┬───────┘
                              │  WebSocket / WSS
                              ▼
┌─────────────────────────────────────────────────────┐
│                   网关层 (Gateway)                    │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  API Server  │  │  Relay Node  │                 │
│  │  (Hono)      │  │  (WebSocket) │                 │
│  └──────┬───────┘  └──────┬───────┘                 │
└─────────┼─────────────────┼─────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────┐
│                  服务层 (Services)                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  Agent Mgr │  │  Session   │  │  Project   │    │
│  │  (进程管理) │  │  Service   │  │  Service   │    │
│  └─────┬──────┘  └────────────┘  └────────────┘    │
│        │                                             │
│  ┌─────┴──────┐  ┌────────────────────┐             │
│  │  Agent     │  │  Notification      │             │
│  │  Adapter   │  │  Service (Push)    │             │
│  │  (协议适配) │  │                    │             │
│  └────────────┘  └────────────────────┘             │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐         ┌─────────────────────┐
│  宿主层 (Host)       │         │  数据层 (Storage)    │
│  ┌───────────────┐  │         │  ┌──────────┐       │
│  │ Daemon        │  │         │  │  SQLite  │       │
│  │ (node-pty)    │  │         │  │ (Drizzle)│       │
│  │               │  │         │  └──────────┘       │
│  │ ┌───────────┐ │  │         │  ┌──────────┐       │
│  │ │Claude Code│ │  │         │  │  Redis   │       │
│  │ ├───────────┤ │  │         │  │ (Cache)  │       │
│  │ │  Codex    │ │  │         │  └──────────┘       │
│  │ ├───────────┤ │  │         └─────────────────────┘
│  │ │ OpenCode  │ │  │
│  │ └───────────┘ │  │
│  └───────────────┘  │
└─────────────────────┘
```

> **注意**：暂不做桌面客户端。Phase 1 仅 Web，Phase 2 通过 Expo 覆盖移动端（iOS/Android），移动端初期可用 responsive Web 替代。

---

## 二、核心模块设计

### 2.1 Daemon（宿主守护进程）

Daemon 运行在开发者的机器上，负责管理 Agent 进程。

```
Daemon
├── AgentManager        — Agent 进程生命周期管理
│   ├── spawn(agent)    — 通过 node-pty 启动 Agent
│   ├── kill(agent)     — 优雅终止
│   ├── restart(agent)  — 崩溃重启
│   └── list()          — 运行中的 Agent 列表
│
├── SessionManager      — 会话管理
│   ├── create()        — 新建 Agent 会话
│   ├── attach()        — 客户端连接到会话
│   ├── detach()        — 断开但保持会话
│   └── destroy()       — 销毁会话及进程
│
├── OutputParser        — Agent 输出解析器（核心差异化）
│   ├── parseToolUse()  — 识别工具调用（文件读写、命令执行）
│   ├── parseFileDiff() — 提取文件变更内容
│   ├── parseStatus()   — 识别 Agent 状态（思考中、执行中、等待输入）
│   └── parseError()    — 识别错误和异常
│
├── FileSystemWatcher   — 文件变更监听
│   ├── onChange()      — 检测项目文件变更
│   └── sync()          — 变更事件推送给客户端
│
└── Transport           — 通信层
    ├── connect(relay)  — 连接 Relay
    ├── connect(local)  — 局域网直连
    └── reconnect()     — 断线重连
```

**关键实现：Agent 进程管理**

```typescript
// Agent 进程抽象
interface AgentProcess {
  id: string;
  type: 'claude-code' | 'codex' | 'opencode' | 'custom';
  pty: IPty;
  projectPath: string;
  status: 'starting' | 'running' | 'idle' | 'error' | 'stopped';
  createdAt: Date;
  metadata: Record<string, unknown>;
}

// Agent 适配器接口
interface AgentAdapter {
  name: string;
  buildCommand(config: AgentConfig): string[];
  buildEnv(config: AgentConfig): Record<string, string>;
  parseOutput(raw: string): ParsedOutput[];
  formatInput(command: string): string;
}

// 结构化输出事件（核心差异化）
type ParsedEvent =
  | { type: 'status_change'; status: AgentStatus }
  | { type: 'tool_use'; tool: string; args: Record<string, unknown> }
  | { type: 'file_change'; path: string; changeType: 'create' | 'modify' | 'delete'; diff?: string }
  | { type: 'command_exec'; command: string; exitCode?: number }
  | { type: 'thinking'; content: string }
  | { type: 'error'; message: string }
  | { type: 'raw_output'; content: string };
```

### 2.2 Gateway（API 网关）

```
Gateway (Hono)
├── /api/v1
│   ├── /auth           — 认证（轻量级，Token-based）
│   │   ├── POST /token         — 生成访问 Token
│   │   └── POST /token/verify  — 验证 Token
│   │
│   ├── /hosts          — 宿主机管理
│   │   ├── GET    /          — 列出已注册宿主机
│   │   ├── POST   /          — 注册新宿主机
│   │   ├── GET    /:id       — 宿主机状态
│   │   └── DELETE /:id       — 注销宿主机
│   │
│   ├── /agents         — Agent 管理
│   │   ├── GET    /          — 列出 Agent 会话
│   │   ├── POST   /start     — 启动 Agent
│   │   ├── POST   /:id/stop  — 停止 Agent
│   │   ├── GET    /:id/output — 获取输出历史
│   │   └── GET    /:id/events — 获取结构化事件流
│   │
│   └── /projects       — 项目管理
│       ├── GET    /          — 项目列表
│       ├── GET    /:id       — 项目详情
│       ├── GET    /:id/files — 文件树
│       └── GET    /:id/changes — 文件变更历史
│
└── /ws
    ├── /terminal/:sessionId  — 终端 WebSocket（原始终端流）
    ├── /events/:sessionId    — 结构化事件流 WebSocket
    └── /relay                — Relay 中继通道
```

### 2.3 Relay（中继服务）

解决 NAT 穿透问题，让外部客户端连接到宿主 Daemon。

```
Relay
├── 连接管理
│   ├── host 注册       — Daemon 连接后注册 hostId
│   ├── client 连接     — 客户端连接后绑定 hostId
│   └── 双向数据转发     — host ↔ client 透传
│
├── 消息增强
│   ├── 消息持久化      — 断线重连后恢复（基于 Redis）
│   ├── 消息压缩        — 终端输出 delta 压缩
│   └── 端到端加密      — E2EE，Relay 无法读取内容
│
└── 离线支持
    ├── 离线队列        — 宿主机离线时缓存消息
    └── 推送通知        — 宿主机上线后通知客户端
```

**Relay 协议设计**

```typescript
// 客户端 → Relay → Daemon
interface RelayMessage {
  id: string;
  type: 'terminal_input' | 'command' | 'control';
  payload: string;
  timestamp: number;
  encrypted?: boolean;
  iv?: string;
}

// Daemon → Relay → 客户端
interface RelayEvent {
  id: string;
  type: 'terminal_output' | 'parsed_event' | 'status_change' | 'file_change' | 'notification';
  payload: string;
  timestamp: number;
  sessionId: string;
}
```

### 2.4 客户端架构

#### Web App（React + Vite）/ Mobile（Expo，Phase 2+）

```
App
├── screens/
│   ├── DashboardScreen     — 宿主机列表、Agent 状态概览
│   ├── TerminalScreen      — xterm.js 终端
│   ├── ProjectScreen       — 项目文件浏览
│   ├── AgentDetailScreen   — Agent 详情（结构化事件、文件变更）
│   └── SettingsScreen      — 配置
│
├── components/
│   ├── Terminal/           — xterm.js 终端组件
│   │   ├── TerminalView
│   │   ├── TerminalToolbar
│   │   └── InputBar
│   │
│   ├── Agent/              — Agent 相关组件
│   │   ├── AgentCard       — Agent 状态卡片
│   │   ├── AgentStatus     — 状态指示器（思考中/执行中/等待输入）
│   │   ├── EventTimeline   — 结构化事件时间线
│   │   ├── FileChangeList  — 文件变更列表
│   │   └── CommandHistory  — 命令历史
│   │
│   ├── Project/            — 项目组件
│   │   ├── FileTree
│   │   ├── FileViewer
│   │   └── DiffViewer
│   │
│   └── Common/             — 通用组件
│       ├── ConnectionStatus
│       └── PushNotification
│
├── services/
│   ├── WebSocketService    — WebSocket 连接管理
│   ├── AgentService        — Agent CRUD 操作
│   ├── EventParserService  — 结构化事件处理
│   └── AuthService         — 认证
│
└── stores/
    ├── connectionStore     — 连接状态
    ├── agentStore          — Agent 状态
    ├── eventStore          — 结构化事件
    └── settingsStore       — 用户设置
```

---

## 三、数据模型

Phase 1 使用 SQLite（零运维，嵌入 Daemon），后续可迁移到 PostgreSQL。

```sql
-- 宿主机
CREATE TABLE hosts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  hostname    TEXT,
  os          TEXT,
  status      TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error')),
  last_seen   TEXT,           -- ISO 8601
  public_key  TEXT,           -- E2EE 公钥
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Agent 会话
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  host_id     TEXT REFERENCES hosts(id),
  agent_type  TEXT NOT NULL,   -- 'claude-code' | 'codex' | 'opencode' | 'custom'
  project_path TEXT NOT NULL,
  status      TEXT DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'idle', 'error', 'stopped')),
  started_at  TEXT DEFAULT (datetime('now')),
  stopped_at  TEXT
);

-- Agent 结构化事件日志
CREATE TABLE session_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  type        TEXT NOT NULL,    -- 'status_change' | 'tool_use' | 'file_change' | 'command_exec' | 'thinking' | 'error' | 'raw_output'
  content     TEXT NOT NULL,    -- JSON
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 文件变更记录
CREATE TABLE file_changes (
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  file_path   TEXT NOT NULL,
  change_type TEXT NOT NULL,    -- 'create' | 'modify' | 'delete'
  diff        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## 四、技术栈选型

| 层级 | 技术 | 选型理由 |
|------|------|---------|
| **API Gateway** | Hono | 比 Express 快 3-5x，TypeScript 原生，Edge 兼容 |
| **Agent 运行时** | node-pty | 管理伪终端，轻量可靠 |
| **数据库** | SQLite（Phase 1-2）→ PostgreSQL（可选） | 零运维起步，后续可迁移 |
| **ORM** | Drizzle | 类型安全，轻量，同时支持 SQLite 和 PostgreSQL |
| **缓存** | Redis | 会话缓存、Relay 消息缓冲、发布订阅 |
| **Web 客户端** | React 19 + Vite | 快速开发，生态丰富 |
| **移动客户端** | Expo SDK 54（Phase 2+） | 跨 iOS/Android/Web；Phase 1 用 responsive Web 替代 |
| **终端渲染** | xterm.js | 业界标准，支持 WebGL 加速 |
| **状态管理** | Zustand | 轻量、简洁、TypeScript 友好 |
| **认证** | JWT（自签发） | 轻量级，自部署场景足够 |
| **部署** | Docker | 自部署优先 |
| **CI/CD** | GitHub Actions | 标准化，免费额度够用 |
| **Monorepo** | Turborepo + pnpm | 比 npm workspaces 快，缓存好 |

---

## 五、安全架构

### 5.1 通信安全

```
客户端 ←── E2EE (X25519 + AES-256-GCM) ──→ Daemon
              │
              ▼
          Relay（无法解密）
```

- 所有终端数据端到端加密，Relay 只做透传
- 使用 X25519 密钥交换 + AES-256-GCM 对称加密
- 每个会话独立密钥，会话结束密钥销毁
- Phase 1（局域网）可暂不加密，Phase 2 必须实现

### 5.2 访问控制

```
认证层：
├── JWT Token（自签发，可配置过期时间）
├── 设备配对（QR Code / Token 交换）
└── 可选 OAuth 2.0（GitHub 登录）

授权层：
├── 宿主机绑定 — 每个 Host 绑定到 Owner
├── 操作确认   — 危险操作需客户端二次确认
└── API 限流   — 基础速率限制
```

### 5.3 Agent 沙箱（可选）

- 可选 Docker 容器隔离 Agent 进程
- 限制文件系统访问范围（项目目录 + 临时目录）
- 网络出站白名单
- 资源限制（CPU、内存、磁盘）

---

## 六、性能设计

| 指标 | 目标 | 方案 |
|------|------|------|
| 终端延迟（局域网） | < 50ms | 直连模式，无 Relay |
| 终端延迟（远程） | < 200ms | Relay 就近节点 + delta 压缩 |
| 断线重连 | < 3s | Redis 消息缓冲 + 快速重连协议 |
| 并发 Agent | 10+/宿主机 | node-pty 轻量进程，限制内存 |
| 文件同步 | < 5s 延迟 | chokidar + 增量 diff |

---

## 七、可扩展性设计

### Agent 适配器插件

```typescript
// 自定义 Agent 适配器接口
interface AgentAdapterPlugin {
  name: string;
  version: string;

  // Agent 发现
  detect(projectPath: string): boolean;

  // 进程管理
  buildSpawnConfig(config: StartAgentConfig): SpawnConfig;

  // 输出解析（核心差异化）
  parseOutput(raw: string): AsyncGenerator<ParsedEvent>;

  // 命令构造
  buildCommand(action: AgentAction): string;
}
```

用户可以通过编写 Adapter 插件支持任意 CLI Agent。

### MCP 工具集成

```typescript
// MCP Server 注册
interface MCPToolRegistration {
  name: string;
  serverCommand: string;
  args: string[];
  description: string;
}
```

FlowWhips 自身作为 MCP Client，可以为 Agent 提供额外的工具（如远程通知、审批流、文件浏览）。
