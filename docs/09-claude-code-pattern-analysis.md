# Claude Code 架构模式分析与 FlowWhips 借鉴建议

> 版本：1.0 | 日期：2026-04-19
> 源码：`extends/open-claude-code/` (~1,900 文件, 512K+ LOC, Bun + React/Ink TUI)

---

## 一、分析背景

Claude Code 是 Anthropic 的终端 AI 编程助手，2026-03-31 因 source map 泄露导致 TypeScript 源码公开。本分析提取其架构模式，评估哪些值得 FlowWhips 借鉴。

### 关键差异定位

```
Claude Code: 终端 AI 助手 — 本地运行，用户直接交互，Agent 即进程本身
FlowWhips:   远程编排平台 — 控制多个 Agent，跨设备远程操控，结构化理解行为
```

**核心结论**: Claude Code 是「Agent 本体」，FlowWhips 是「Agent 控制面」。借鉴重点在工具系统设计、错误处理、配置模式等横切关注点，而非 Agent 核心逻辑。

---

## 二、七大架构模式详解

### 2.1 Tool System — `buildTool` 工厂模式 ⭐⭐⭐ 强烈推荐

**文件**: `src/Tool.ts` (792 行), `src/tools.ts` (389 行)

#### 核心设计

```typescript
// Tool.ts — 工厂函数 + 安全默认值
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false, // 默认不安全
  isReadOnly: (_input?: unknown) => false, // 默认写操作
  isDestructive: (_input?: unknown) => false,
  checkPermissions: (input, _ctx) => Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: (_input?) => '', // 安全工具必须覆写
  userFacingName: () => '',
};

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def };
}
```

**每个工具定义**:

1. `name` — 工具标识符
2. `inputSchema` — Zod schema 验证输入
3. `isConcurrencySafe(input)` — 是否可并行执行
4. `isReadOnly(input)` — 是否只读
5. `checkPermissions(input, ctx)` — 权限检查
6. `execute(input, context)` — 核心执行逻辑
7. `renderToolUseMessage(input)` — UI 渲染

**工具注册** (`tools.ts`):

- `assembleToolPool()` — 合并内置工具 + MCP 工具 + 技能工具，自动去重
- `filterToolsByDenyRules()` — 根据 deny 规则预过滤

**并发控制**:

- 只读工具可并行（`isConcurrencySafe → true`）
- 写操作工具串行执行
- `interruptBehavior()` 返回 `'cancel'` | `'block'`

#### 对 FlowWhips 的价值

| 方面     | Claude Code                  | FlowWhips 现状                          | 建议                                |
| -------- | ---------------------------- | --------------------------------------- | ----------------------------------- |
| 工具定义 | `buildTool` 工厂 + 默认值    | `packages/daemon/src/mcp/tools/` 裸函数 | **采用** 工厂模式                   |
| 输入验证 | Zod schema per tool          | Zod schema 已在用                       | ✅ 已对齐                           |
| 并发安全 | `isConcurrencySafe` 声明     | 无                                      | **新增** — Agent 操作需并发控制     |
| 权限模型 | 多模式 (default/auto/bypass) | `PermissionEngine` allow/deny           | **增强** — 添加 auto-approve 分类器 |
| 工具注册 | 动态池 + 去重                | 静态注册                                | **采用** 动态注册                   |

**具体实现建议**:

```typescript
// packages/shared/src/tools/types.ts — 新增
interface ToolDefinition<Input, Output> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  isReadOnly: (input: Input) => boolean;
  isConcurrencySafe: (input: Input) => boolean;
  checkPermissions: (input: Input, ctx: ToolContext) => Promise<PermissionResult>;
  execute: (input: Input, ctx: ToolContext) => Promise<Output>;
}

function buildTool<I, O>(
  def: Partial<ToolDefinition<I, O>> & Pick<ToolDefinition<I, O>, 'name' | 'execute'>,
): ToolDefinition<I, O>;
```

---

### 2.2 Error Handling — 分类错误 + 指数退避重试 ⭐⭐⭐ 强烈推荐

**文件**: `src/utils/errors.ts` (238 行), `src/services/api/withRetry.ts`, `src/services/api/errors.ts`

#### 核心设计

**错误类层次**:

```typescript
class ClaudeError extends Error {
  // 基础错误
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name; // 关键：设 name
  }
}

class ConfigParseError extends Error {
  // 携带上下文
  filePath: string;
  defaultConfig: unknown;
}

class ShellError extends Error {
  // PTY 输出
  stdout: string;
  stderr: string;
  code: number;
  interrupted: boolean;
}

class TelemetrySafeError extends Error {
  // 安全日志
  telemetryMessage: string; // 脱敏消息
}
```

**错误分类器** (关键模式):

```typescript
// services/api/errors.ts
function classifyAPIError(error: unknown): string; // → 'rate_limit' | 'auth' | 'server' | 'network' | 'unknown'
function classifyAxiosError(e: unknown): { kind; status; message };
function classifyToolError(error: unknown): string; // → 'timeout' | 'permission' | 'mcp' | 'abort' | ...
```

**重试策略**:

```typescript
// services/api/withRetry.ts
class CannotRetryError extends Error {} // 不可重试标记
class FallbackTriggeredError extends Error {} // 降级触发

// QueryEngine 重试配置
POST_BASE_DELAY_MS = 500; // 初始退避
POST_MAX_DELAY_MS = 8000; // 最大退避
QUERY_MAX_RETRIES = 10; // 最大重试

// SSE 重连
RECONNECT_BASE_DELAY_MS = 1000; // 重连退避
maxReconnectDelay = 30_000; // 最大重连延迟
maxTotalReconnectTime = 10 * 60 * 1000; // 10 分钟后放弃
```

#### 对 FlowWhips 的价值

| 方面                           | 建议                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 错误类层次                     | **采用** — FlowWhips 已有 `FlowWhipsError` 基类，扩展为 `ShellError`、`CryptoError`、`McpError`、`ConfigParseError` |
| 错误分类器                     | **新增** — 为 API 调用、MCP 连接、PTY 进程添加 `classify*Error()`                                                   |
| 重试策略                       | **采用** — Relay 连接、MCP 重连、API 调用统一重试逻辑                                                               |
| `this.name = constructor.name` | **必须** — 已在 FlowWhips 中使用                                                                                    |

**具体实现建议**:

```typescript
// packages/shared/src/errors.ts — 增强
export class FlowWhipsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ShellError extends FlowWhipsError {
  constructor(
    public stdout: string,
    public stderr: string,
    public exitCode: number,
  ) {
    super('Shell command failed', 'SHELL_ERROR');
  }
}

export class CryptoError extends FlowWhipsError {}
export class McpError extends FlowWhipsError {}
export class ConfigParseError extends FlowWhipsError {
  constructor(
    message: string,
    public filePath: string,
    public defaultConfig: unknown,
  ) {
    super(message, 'CONFIG_PARSE_ERROR');
  }
}

export function classifyRelayError(
  error: unknown,
): 'timeout' | 'auth' | 'network' | 'crypto' | 'unknown';
export function classifyMcpError(
  error: unknown,
): 'connection' | 'timeout' | 'tool_not_found' | 'unknown';
```

---

### 2.3 Configuration — JSON + Zod 验证 + 迁移 ⭐⭐ 推荐

**文件**: `src/utils/config.ts` (1817 行), `src/migrations/`, `src/schemas/`

#### 核心设计

**分层配置**:

- `GlobalConfig` — 全局用户设置 (`~/.claude/config.json`)
- `ProjectConfig` — 项目级设置 (`.claude/config.json`)
- 合并策略：Project 覆盖 Global

**加载模式**:

```typescript
getGlobalConfig(): GlobalConfig       // 读取全局 + 文件监听
getProjectConfig(): ProjectConfig      // 项目级 + fallback 到全局
```

**验证**: Zod v4 schema 验证，解析失败返回 `ConfigParseError` + 默认配置

**迁移系统**: `src/migrations/` 目录管理配置格式变更

#### 对 FlowWhips 的价值

| 方面     | FlowWhips 现状             | 建议                           |
| -------- | -------------------------- | ------------------------------ |
| 配置格式 | ProviderRegistry 使用 JSON | **标准化** — 统一全局/项目配置 |
| 验证     | Zod 已在用                 | ✅ 已对齐                      |
| 迁移     | 无                         | **暂缓** — Phase 7+ 再加       |
| 文件监听 | 无                         | **考虑** — daemon 热加载配置   |

---

### 2.4 MCP Integration — 官方 SDK + 多传输 ⭐⭐⭐ 强烈推荐

**文件**: `src/services/mcp/client.ts` (3348 行), `src/services/mcp/config.ts`

#### 核心设计

**传输方式**:

- `StdioClientTransport` — 本地 MCP 服务器（子进程）
- `SSEClientTransport` — 远程 MCP 服务器
- `StreamableHTTPClientTransport` — HTTP MCP

**工具暴露**:

```typescript
buildMcpToolName(serverName, toolName) → "mcp__serverName__toolName"
```

MCP 工具与内置工具在 `assembleToolPool()` 中合并为统一池，LLM 不区分。

**OAuth 支持**: 完整 OAuth 2.0 流程 + Token 刷新

#### 对 FlowWhips 的价值

| 方面       | FlowWhips 现状                              | 建议                                             |
| ---------- | ------------------------------------------- | ------------------------------------------------ |
| MCP Server | ✅ 已有 `packages/daemon/src/mcp/server.ts` | 已对齐                                           |
| MCP Client | 无                                          | **新增** — daemon 作为 MCP client 连接外部服务器 |
| 工具命名   | 无前缀                                      | **采用** `mcp__server__tool` 命名空间            |
| OAuth      | 无                                          | **暂缓** — 初始版本无需                          |

**关键差异**: Claude Code 是 MCP **client**（连接外部 MCP 服务器获取工具），FlowWhips daemon 是 MCP **server**（暴露自身能力给 Agent）。但 FlowWhips 也应成为 MCP client 来聚合外部工具。

---

### 2.5 Context/History — JSONL + 滑动窗口 + 摘要压缩 ⭐⭐ 推荐

**文件**: `src/history.ts` (464 行), `src/context.ts` (189 行), `src/services/compact/`

#### 核心设计

**历史存储**: JSONL 格式，每行一条消息

```typescript
MAX_HISTORY_ITEMS = 100; // 滑动窗口
```

**大内容处理**: 粘贴内容单独存储，消息中只保留 hash 引用

**Context 采集** (memoized):

```typescript
getSystemContext(); // git status, env, cwd — lodash memoize
getUserContext(); // CLAUDE.md, project docs — lodash memoize
```

**压缩策略** (3 级):

1. `microCompact` — 轻量摘要
2. `autoCompact` — 自动触发
3. `sessionMemoryCompact` — 会话记忆

**Token 估算**: `services/tokenEstimation.ts` 用于上下文窗口管理

#### 对 FlowWhips 的价值

| 方面       | FlowWhips 现状                | 建议                                |
| ---------- | ----------------------------- | ----------------------------------- |
| 历史存储   | AgentSnapshot.timeline (内存) | **增强** — JSONL 持久化             |
| 滑动窗口   | 200 条 TimelineItem           | ✅ 已对齐                           |
| 大内容     | 无处理                        | **新增** — 大输出存磁盘 + hash 引用 |
| 摘要压缩   | 无                            | **暂缓** — Phase 7+                 |
| Token 估算 | 无                            | **新增** — 估算 Agent 上下文使用量  |

---

### 2.6 Streaming/Parser — SSE 帧解析 + 增量处理 ⭐ 可选

**文件**: `src/cli/transports/SSETransport.ts` (711 行), `src/QueryEngine.ts`

#### 核心设计

**SSE 解析器**:

```typescript
parseSSEFrames(buffer: string)  // 增量解析 SSE 帧
// 处理 event/id/data 字段
// 支持 comment frames (:keepalive)
// 返回 parsed frames + remaining buffer
```

**进度回调**:

```typescript
ToolCallProgress<P>; // 工具执行进度
renderToolUseProgressMessage(); // UI 渲染
```

#### 对 FlowWhips 的价值

**评估**: Claude Code 的 SSE 解析是为其 Anthropic API 流式响应设计的。FlowWhips 使用 `node-pty` 获取 Agent 输出，然后通过自定义 `AgentAdapter.parseOutput()` 解析。两者场景不同。

| 方面         | 建议                                           |
| ------------ | ---------------------------------------------- |
| SSE 解析     | **跳过** — FlowWhips 用 PTY 而非 SSE           |
| 增量解析思路 | **借鉴** — AgentAdapter 应支持增量解析（流式） |
| 进度回调     | **借鉴** — 工具执行进度的回调模式              |
| 大输出处理   | **借鉴** — 磁盘存储 + 截断预览                 |

---

### 2.7 Agent Process Management — 类型化任务 + 状态持久化 ⭐⭐ 推荐

**文件**: `src/Task.ts` (125 行), `src/tasks/`

#### 核心设计

**任务类型**:

```typescript
type TaskType =
  | 'local_bash' // 本地 shell
  | 'local_agent' // 本地子 Agent
  | 'remote_agent' // 远程 Agent
  | 'in_process_teammate' // 进程内队友
  | 'local_workflow' // 工作流
  | 'monitor_mcp' // MCP 监控
  | 'dream'; // 后台思考
```

**任务状态**: `pending` → `running` → `completed` / `failed` / `killed`

**ID 生成**: `generateTaskId(type)` — 类型前缀 + 9 字符加密随机

**状态持久化**: 输出写入磁盘 `getTaskOutputPath(id)`，`outputOffset` 跟踪读取位置

#### 对 FlowWhips 的价值

| 方面            | FlowWhips 现状                     | 建议                          |
| --------------- | ---------------------------------- | ----------------------------- |
| Agent 类型      | `claude-code`, `codex`, `opencode` | ✅ 已对齐                     |
| 状态机          | 6 状态 discriminated union         | ✅ 已对齐 — 更好              |
| ID 生成         | UUID                               | **考虑** — 类型前缀有调试价值 |
| 输出持久化      | `AgentSnapshot.timeline` 内存      | **增强** — 磁盘持久化大输出   |
| AbortController | 无                                 | **新增** — Agent 取消机制     |

---

## 三、优先级排序的实施建议

### P0 — 立即实施（Week 1-2 价值）

| #   | 模式                      | 来源            | 目标文件                                 | 工作量 |
| --- | ------------------------- | --------------- | ---------------------------------------- | ------ |
| 1   | **`buildTool` 工厂模式**  | Tool System     | `packages/shared/src/tools/` 新建        | 2-3 天 |
| 2   | **错误分类器 + 重试策略** | Error Handling  | `packages/shared/src/errors.ts` 增强     | 1-2 天 |
| 3   | **MCP Client 能力**       | MCP Integration | `packages/daemon/src/mcp/client.ts` 新建 | 2-3 天 |

### P1 — 近期实施（Week 3-4 价值）

| #   | 模式                 | 来源            | 目标文件                                    | 工作量 |
| --- | -------------------- | --------------- | ------------------------------------------- | ------ |
| 4   | **工具并发控制**     | Tool System     | `packages/daemon/src/agent/manager.ts` 增强 | 1 天   |
| 5   | **JSONL 历史持久化** | Context/History | `packages/daemon/src/agent/history.ts` 新建 | 1-2 天 |
| 6   | **统一配置系统**     | Configuration   | `packages/shared/src/config/` 新建          | 2-3 天 |

### P2 — 中期实施（Phase 4-5）

| #   | 模式                             | 来源            | 目标文件                                   | 工作量 |
| --- | -------------------------------- | --------------- | ------------------------------------------ | ------ |
| 7   | **大输出磁盘存储**               | Tool System     | `packages/daemon/src/storage/` 新建        | 2 天   |
| 8   | **Agent 取消 (AbortController)** | Task Management | `packages/daemon/src/agent/manager.ts`     | 1 天   |
| 9   | **类型前缀 ID**                  | Task Management | `packages/shared/src/utils/`               | 0.5 天 |
| 10  | **Token 估算**                   | Context/History | `packages/shared/src/utils/tokens.ts` 新建 | 1 天   |

### P3 — 远期考虑（Phase 7+）

| #   | 模式                | 来源            | 说明                 |
| --- | ------------------- | --------------- | -------------------- |
| 11  | 上下文压缩/摘要     | Compact Service | Agent 上下文窗口管理 |
| 12  | 配置迁移系统        | Configuration   | 格式变更管理         |
| 13  | MCP OAuth 支持      | MCP Integration | 企业级 MCP 服务器    |
| 14  | Telemetry-safe 日志 | Error Handling  | 生产环境安全日志     |

---

## 四、不应借鉴的部分

| Claude Code 模式             | 原因                                               |
| ---------------------------- | -------------------------------------------------- |
| React + Ink TUI              | FlowWhips 是 Web/Mobile UI，不是终端 UI            |
| SSE 传输                     | FlowWhips 用 PTY + 二进制 WebSocket，不是 HTTP SSE |
| QueryEngine (46K 行)         | 直接调用 LLM API，FlowWhips 编排的是 Agent CLI     |
| Feature Flags (`bun:bundle`) | FlowWhips 用 Node.js，非 Bun                       |
| GrowthBook 分析              | FlowWhips 是开源项目，无需 A/B 测试框架            |
| Coordinator 多 Agent 编排    | FlowWhips 有自己的 Pipeline 系统                   |
| Vim 模式 / Buddy sprite      | 终端特有功能，不适用                               |

---

## 五、总结

### 借鉴价值矩阵

```
高价值 ─────────────────────────────────────────
  │  buildTool 工厂     错误分类+重试    MCP Client
  │
中价值 ─────────────────────────────────────────
  │  并发控制    JSONL 历史    统一配置    AbortController
  │
低价值 ─────────────────────────────────────────
  │  Token 估算    类型 ID    大输出存储    压缩策略
  │
不借鉴 ─────────────────────────────────────────
     Ink TUI    SSE 传输    QueryEngine    Feature Flags
```

### 核心洞察

1. **FlowWhips 的 Agent 状态机已经比 Claude Code 更好** — 6 状态 discriminated union + VALID_TRANSITIONS 强约束，Claude Code 只有简单的 pending/running/completed/failed/killed
2. **FlowWhips 的二进制协议设计更优** — Channel 多路复用比 Claude Code 的 SSE 文本流更适合实时远程控制
3. **Claude Code 的工具系统更成熟** — buildTool 工厂 + 权限上下文 + 并发安全，值得全面采用
4. **Claude Code 的错误处理更健壮** — 分类器模式 + 指数退避，生产级可靠

### 行动项

完成 Phase 1-5 后，按照 P0 → P1 → P2 优先级逐步引入上述模式。P0 项目（buildTool + 错误处理 + MCP Client）预计 5-8 天工作量，可立即开始。
