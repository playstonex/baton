# Paseo 代码复用可行性分析

> 分析日期：2026-04-18

---

## 一、许可证约束

### 核心问题：AGPL-3.0 vs Apache-2.0

Paseo 使用 **AGPL-3.0** 许可证，FlowWhips 使用 **Apache-2.0**。

AGPL-3.0 是强 copyleft 许可证：

- 任何包含 AGPL 代码的派生作品必须同样以 AGPL 发布
- 通过网络提供服务也必须公开源代码（这是 AGPL 比 GPL 更严格的地方）
- **不能将 AGPL 代码复制到 Apache-2.0 项目中**

### 三条合法利用 Paseo 的路径

| 路径                             | 方式                                  | 风险                           |
| -------------------------------- | ------------------------------------- | ------------------------------ |
| **A. 安装 Paseo npm 包作为依赖** | `pnpm add @getpaseo/relay` 等         | 组合体仍需 AGPL 合规           |
| **B. 学习模式重写**              | 阅读 Paseo 实现，用自己的代码重新实现 | ✅ 安全 — 思路不受版权保护     |
| **C. 复用相同的底层库**          | 安装 Paseo 使用的相同 npm 包          | ✅ 最安全 — 这些包有自己的许可 |

**推荐：路径 B + C 组合**

---

## 二、逐项复用策略

### ✅ 路径 C — 复用相同底层库（最快，零风险）

| 功能                   | Paseo 用的库                                          | FlowWhips 做法                                                            | 工作量 |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| **E2E 加密**           | `tweetnacl` (NaCl box)                                | `pnpm add tweetnacl`，照着 Paseo 的 ECDH + XSalsa20-Poly1305 流程自己实现 | 2-3 天 |
| **QR 码生成**          | `qrcode`                                              | `pnpm add qrcode`，daemon 端生成 QR                                       | 1 天   |
| **QR 码扫描 (mobile)** | `expo-camera`                                         | 已在 mobile 的依赖中可添加                                                | 1 天   |
| **Agent SDK 集成**     | `@anthropic-ai/claude-agent-sdk` / `@opencode-ai/sdk` | 直接安装使用，替代 FlowWhips 的裸 node-pty spawn                          | 2-3 天 |
| **语音 STT**           | `sherpa-onnx-node` + `@deepgram/sdk`                  | 安装同样库，实现 STT pipeline                                             | 3-5 天 |
| **语音 TTS**           | `openai` (TTS API) + `sherpa-onnx` (本地)             | 安装同样库                                                                | 3-5 天 |
| **MCP Server**         | `@modelcontextprotocol/sdk`                           | 安装 MCP SDK，实现 tools                                                  | 3-5 天 |
| **代码高亮**           | Lezer (`@lezer/*`)                                    | 安装 Lezer 自建                                                           | 2-3 天 |
| **配置验证**           | `zod`                                                 | `pnpm add zod`，实现 provider config schema                               | 1 天   |
| **日志**               | `pino` + `pino-pretty`                                | 替换 `console.log`                                                        | 1 天   |
| **Native 音频**        | `expo-audio` / `expo-av`                              | 已可添加                                                                  | 1 天   |

### ⚠️ 路径 B — 学习模式重写（中等，需理解后重实现）

| 功能                     | Paseo 实现要点                                                                  | FlowWhips 适配方式                                   | 工作量 |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ |
| **Agent 状态机**         | `initializing → idle → running → idle/error → closed` + file-backed persistence | 学习状态设计，在 `daemon/src/agent/manager.ts` 重写  | 3-4 天 |
| **Provider 适配器**      | 统一接口 + 每个 provider 独立适配器 + output parser                             | FlowWhips 已有 `BaseAgentAdapter`，扩展加入 SDK 集成 | 3-4 天 |
| **WebSocket 协议**       | Hello/Welcome 握手 + channel multiplex + session 管理                           | 重设计 FlowWhips 的 protocol 层                      | 3-4 天 |
| **Worktree 管理**        | `git worktree add/list/remove` + per-worktree agent session                     | 新模块 `daemon/src/worktree/`                        | 2-3 天 |
| **自定义 Provider 系统** | config.json schema + provider profiles + binary path                            | 在 shared 或 gateway 中添加 provider registry        | 3-4 天 |
| **Agent 输出解析**       | highlight 包 + tool call parsers + structured events                            | 扩展 FlowWhips 的 `parser/index.ts`                  | 3-5 天 |
| **定时任务/循环**        | schedule service + loop service                                                 | 新模块 `daemon/src/scheduler/`                       | 2-3 天 |
| **权限系统**             | permit allow/deny rules for agent tool calls                                    | 在 daemon 添加 permission middleware                 | 2-3 天 |

### 🔴 路径 A — 不建议直接安装 Paseo npm 包

| 包                 | 原因                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `@getpaseo/server` | AGPL 会传染整个项目；Paseo server 是 Express，FlowWhips 用 Hono           |
| `@getpaseo/app`    | Expo RN app，FlowWhips 有自己的 web (React+Vite) + mobile (Expo) 分离架构 |
| `@getpaseo/relay`  | 核心加密逻辑可以直接用 `tweetnacl` 重写                                   |
| `@getpaseo/cli`    | 依赖 Paseo server 的 client 库                                            |

---

## 三、Paseo E2EE 设计参考（学习用，需自己实现）

Paseo 的 E2E 加密方案值得学习：

```
握手流程:
  1. client 生成 ECDH 密钥对 (publicKeyC, secretKeyC)
  2. daemon 生成 ECDH 密钥对 (publicKeyD, secretKeyD)
  3. 双方通过 relay 交换公钥
  4. 各自计算共享密钥: sharedKey = nacl.box.before(peerPubKey, mySecrKey)

传输:
  每条消息 = nacl.box.encrypt(payload, nonce, receiverPubKey, senderSecrKey)
  nonce = 递增计数器 (防重放)
  relay 只看到密文 — 零知识

信任锚:
  QR 码/配对链接包含 daemon 的公钥指纹
  客户端验证指纹后信任
```

FlowWhips 实现：

- 安装 `tweetnacl`
- 实现同样的 ECDH + XSalsa20-Poly1305 流程
- 配对方式可保持 6 位数字码 + QR 码双通道

---

## 四、Paseo MCP Server 设计参考

Paseo 的 MCP Server 提供以下工具，FlowWhips 可参考实现：

```typescript
// FlowWhips MCP Server 设计
const server = new McpServer({ name: "flowwhips-daemon", version: "0.1.0" });

// Agent 管理
server.tool("agent_create", { provider, projectPath, prompt }, ...);
server.tool("agent_list", {}, ...);
server.tool("agent_stop", { sessionId }, ...);
server.tool("agent_send", { sessionId, message }, ...);
server.tool("agent_inspect", { sessionId }, ...);

// Worktree 管理
server.tool("worktree_create", { basePath, branch }, ...);
server.tool("worktree_list", {}, ...);
server.tool("worktree_archive", { path }, ...);

// Provider 管理
server.tool("provider_list", {}, ...);
server.tool("provider_models", { provider }, ...);

// 权限管理
server.tool("permit_allow", { tool }, ...);
server.tool("permit_deny", { tool }, ...);
```
