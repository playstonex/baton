# Remodex 对比分析

> 日期：2026-04-27
> 版本：v1.0
> 参考：https://www.phodex.app/，./extends/remodex，./extends/open-claude-code

---

## 一、项目定位对比

| 维度 | Remodex | Baton (FlowWhips) | Claude Code |
|------|---------|-------------------|-------------|
| **核心场景** | 从 iPhone 远程控制 Codex | 浏览器/手机多代理编排 | 终端内交互编码 |
| **代理支持** | 仅 Codex（单一） | Claude Code + Codex + OpenCode | Claude 模型 |
| **终端 UI** | 无（仅对话式） | 终端模拟器 + 监控面板 | Ink (React) TUI |
| **对话式 UI** | iOS 原生 Timeline | 无 | TUI 消息列表 |
| **移动端** | 原生 SwiftUI（仅 iOS） | Expo React Native（跨平台）| 无 |
| **Web 端** | 无 | React 19 + Vite | 无 |
| **本地优先** | 极致：无账号、无云 | 本地 daemon + 可选 relay | 本地 CLI |
| **架构** | Bridge + Relay + iOS App（3层）| Daemon + Gateway + Relay + App + Mobile + CLI（6层）| 单进程 CLI |
| **运行时** | Node.js | Bun + Rust + Node | Bun |
| **成熟度** | v1.3.4（早期） | 功能较全 | 生产级 |

---

## 二、架构对比

### Remodex（3层架构）
```
┌──────────────────┐
│  iOS App         │  SwiftUI, 对话式 Timeline
│  (CodexMobile)   │  消息发送 / 结果展示
└────────┬─────────┘
         │ WebSocket (E2E 加密)
┌────────▼─────────┐
│  Relay           │  Node.js WebSocket Server
│  (relay/)        │  Session 管理 + 设备信任 + 配对码
└────────┬─────────┘
         │ WebSocket
┌────────▼─────────┐
│  Bridge          │  Node.js CLI (remodex)
│  (phodex-bridge) │  Codex JSON-RPC 适配
└────────┬─────────┘
         │ JSON-RPC (stdin/stdout)
┌────────▼─────────┐
│  Codex           │  codex app-server
│  (agent)         │  JSON-RPC 接口
└──────────────────┘
```

### Baton（6层架构）
```
┌──────────────────┐
│  Web App / Mobile│  React 19 / Expo RN
│  (packages/app,  │  终端 + 事件面板
│   packages/mobile)│
└────────┬─────────┘
         │ WebSocket
┌────────▼─────────┐
│  Relay           │  Bun WebSocket Server
│  (packages/relay)│  NaCl E2E 加密
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Gateway         │  Bun HTTP Server
│  (packages/gateway│  JWT Auth + 6位配对码
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Daemon          │  Bun Process
│  (packages/daemon│  AgentManager + Parser
└────────┬─────────┘
         │ Rust PTY Bridge
┌────────▼─────────┐
│  Agents          │  Claude Code / Codex / OpenCode
└──────────────────┘
```

---

## 三、关键技术点对比

### 3.1 代理通信

| 特性 | Remodex | Baton | Claude Code |
|------|---------|-------|-------------|
| **连接方式** | `codex app-server`（JSON-RPC） | Rust PTY 桥接 | 直接 stdin/stdout |
| **输入方式** | JSON-RPC `method: turn/steer` | `pty.write(data)` | `prependUserMessage()` |
| **输出格式** | JSON-RPC 结构化事件 | PTY 原始输出 + Parser 解析 | SDK 协议事件 |
| **多代理** | 不支持 | ✅ 状态机管理多个 | 内置 sub-agent |

### 3.2 安全与配对

| 特性 | Remodex | Baton | Claude Code |
|------|---------|-------|-------------|
| **配对方式** | QR 码 | 6位数字码 | 无需（本地） |
| **身份密钥** | Ed25519 设备密钥 | 无设备身份 | 无 |
| **会话加密** | X25519 + AES-256-GCM | NaCl xsalsa20-poly1305 | 无（本地） |
| **签名验证** | ✅ 防重放单调计数器 | ❌ | ❌ |
| **信任持久化** | ✅ Keychain + 本地文件 | ❌ | ❌ |
| **后台运行** | macOS launchd | 终端保持 | 终端保持 |

### 3.3 交互模式

| 模式 | Remodex | Baton 现状 | Claude Code |
|------|---------|-----------|-------------|
| **运行中插话** | ✅ `turn/steer` JSON-RPC | ❌ | ✅ `prependUserMessage()` |
| **排队后续提示** | ✅ `turn/queue` | ❌ | ✅ prepend 队列 |
| **Fast Mode** | ✅ 低延迟模式 | ❌ | ✅ `/fast` |
| **Plan Mode** | ✅ 先规划后执行 | ❌ | ✅ `/plan` |
| **Sub-agent** | ✅ Codex 内置 | ❌ | ✅ AgentTool |
| **中断当前** | ✅ | ❌ | ✅ ESC |
| **Git 操作** | ✅ 完整 git/* JSON-RPC | ❌ | ✅ 内置 |

---

## 四、Remodex 核心实现细节

### 4.1 消息类型体系

```typescript
// Remodex iOS App 中的消息类型
enum ModelKind {
  turnChat       = "turn/chat",      // 普通对话
  turnSteer      = "turn/steer",     // 运行中插话
  turnQueue      = "turn/queue",     // 排队后续任务
  turnCancel     = "turn/cancel",    // 取消当前 turn
  turnInterrupt  = "turn/interrupt", // 中断当前操作
}

struct TurnModel {
  let id: String
  let kind: ModelKind
  let mode: TurnMode          // fast / plan / default
  let model: AgentModel       // 使用的模型
  let content: [ContentBlock] // 消息内容
  let parentID: String?       // 父 turn ID
  let collaboration: CollaborationMode // 协作模式
}

// 模式枚举
enum TurnMode: String {
  case fast = "fast"         // 低延迟输出
  case plan = "plan"         // 先规划后执行
  case `default` = "default" // 标准模式
}

// 协作模式
enum CollaborationMode: String {
  case solo = "solo"               // 单代理
  case subagent = "subagent"       // 子代理
  case review = "review"           // 审查模式
  case pair = "pair"               // 配对编程
}
```

### 4.2 消息分发架构

```
iPhone WebSocket → Bridge → Codex JSON-RPC

Bridge 主要处理流程：
1. 接收加密消息 → 解密 (AES-256-GCM)
2. 解析 JSON → 判断 route 类型
3. 分发到对应 handler:
   - turn/steer  → codexTransport.send(JSON-RPC)
   - turn/chat   → codexTransport.send(JSON-RPC)
   - turn/cancel → codexTransport.send(取消请求)
   - turn/queue  → 存入队列，等当前 turn 完成
   - git/*       → git-handler.js 本地执行
   - workspace/* → workspace-handler.js
4. Codex 输出 → 加密 → 回传 iPhone
```

### 4.3 Steering 实现（关键）

```javascript
// Remodex bridge.js 中的 steer 处理
function handleSteerTurn(turnModel) {
  // 1. 如果当前有活动 turn，发送 steering 请求
  if (activeTurn) {
    codexTransport.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/steer",
      params: {
        turnId: turnModel.id,
        content: turnModel.content,
        mode: turnModel.mode,       // fast/plan/default
        parentTurnId: turnModel.parentID
      }
    }));
  }
  
  // 2. Codex app-server 会在当前 tool 完成后立即处理 steering
  // 而不是等待整个 turn 完成
}
```

### 4.4 安全传输框架

```javascript
// secure-transport.js 核心结构
{
  v: PAIRING_QR_VERSION,        // QR 协议版本
  relay: relayUrl,              // 中继地址
  sessionId: sessionId,         // 会话 ID
  bridgeIdentityPublicKey: key, // Bridge 公钥 (Ed25519)
  pairingCode: shortCode,       // 短配对码
  expiresAt: timestamp,         // 过期时间
}

// 加密信封
{
  kind: "secureAppMessage",     // 应用消息类型
  sessionId: sessionId,
  sender: "mac" | "iphone",    // 发送方
  seq: monotonicCounter,        // 单调计数器（防重放）
  payload: encryptedBase64,     // AES-256-GCM 密文
}
```

---

## 五、Claude Code 的 Steering 机制

### 5.1 StructuredIO 核心

```typescript
// extended/open-claude-code/src/cli/structuredIO.ts

export class StructuredIO {
  // 内部队列 - 可在处理过程中动态添加
  private prependedLines: string[] = [];
  
  // 关键方法：在任何时刻前置用户消息
  prependUserMessage(content: string): void {
    this.prependedLines.push(
      jsonStringify({
        type: 'user',
        session_id: '',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      } satisfies SDKUserMessage) + '\n',
    );
  }
  
  // 读取循环 - prependedLines 始终优先
  private async *read() {
    for (;;) {
      // 先处理前置队列
      if (this.prependedLines.length > 0) {
        content = this.prependedLines.join('') + content;
        this.prependedLines = [];
      }
      // 再处理 stdin 输入
      yield* splitIntoLines();
    }
  }
}
```

### 5.2 消息格式

```json
{
  "type": "user",
  "session_id": "",
  "message": { "role": "user", "content": "你的提示内容" },
  "parent_tool_use_id": null
}
```

### 5.3 Claude Code 的 Prepended 调用场景

```
1. Hook 注入初始消息 (print.ts)
   structuredIO.prependUserMessage(hookInitialUserMessage)

2. 主线程代理启动时注入 (print.ts)
   structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)

3. 远程 Bridge 恢复会话
   外部通过 StructuredIO 实例注入消息
```

---

## 六、借鉴清单

### 优先级 1：Git 远程操作（高 ROI，低成本）

直接借鉴 Remodex 的 `git-handler.js`，在 Baton daemon 中拦截 `git/*` JSON-RPC 方法：

| 命令 | 说明 | 实现难度 |
|------|------|---------|
| `git/status` | 查看仓库状态 | 低 |
| `git/commit` | 提交代码 | 低 |
| `git/push` | 推送 | 低 |
| `git/pull` | 拉取 | 低 |
| `git/branches` | 分支列表 | 低 |
| `git/checkout` | 切换分支 | 低 |
| `git/createBranch` | 创建分支 | 低 |
| `git/generateCommitMessage` | AI 生成提交消息 | 中 |
| `git/generatePullRequestDraft` | AI 生成 PR 草稿 | 中 |
| `git/stash` / `git/stashPop` | 暂存/恢复 | 低 |
| `git/log` | 提交历史 | 低 |
| `git/createWorktree` | 创建工作树 | 中 |

### 优先级 2：对话式 Steering（核心差异化）

借鉴 Claude Code 的 `prependUserMessage()` + Remodex 的消息类型体系：

- 扩展 `AgentManager` 支持 `prependMessage()` 接口
- 扩展 protocol 增加 `terminal_steer` / `terminal_queue` 消息类型
- Claude Code 代理：直接调用 `StructuredIO.prependUserMessage()`
- Codex 代理：使用 `turn/steer` JSON-RPC
- OpenCode 代理：使用 HTTP API

### 优先级 3：设备信任 + QR 配对

借鉴 Remodex 的安全模型：
- 生成长期设备身份密钥对 (Ed25519)
- QR 码携带 relay URL + sessionId + 公钥
- 首次配对后持久化信任关系
- 后续自动重连

### 优先级 4：启动优化

借鉴 Claude Code 的并行预加载：
```typescript
// 在模块加载前启动预加载
startKeychainPrefetch()
startConfigPrefetch()
```

### 优先级 5：安全日志脱敏

借鉴 Remodex 的 `relaySessionLogLabel`:
```javascript
function sessionLogLabel(sessionId) {
  return 'session#' + sha256(sessionId).slice(0, 8);
}
```

---

## 七、结论

| 维度 | Remodex 从何借鉴 | Claude Code 从何借鉴 |
|------|-----------------|---------------------|
| **交互模型** | 消息类型体系（steer/queue/cancel）| prependUserMessage 机制 |
| **Git 集成** | git-handler.js 完整实现 | — |
| **安全模型** | QR + Ed25519 + AES-256-GCM | — |
| **后台运行** | macOS launchd | parallel prefetch |
| **推送通知** | APNs 集成 | — |
| **日志安全** | SHA256 脱敏 sessionId | — |

**Baton 实现 Remodex 风格对话控制完全可行**，核心改动在于：
1. 扩展 AgentManager 支持 mid-turn 消息注入
2. 扩展 protocol 支持 steer/queue 消息类型
3. 对话式 UI 组件开发
