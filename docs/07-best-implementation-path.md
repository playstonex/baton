# 最佳实现路径

> 分析日期：2026-04-18

---

## 一、核心决策

| 决策点             | 结论                                      | 理由                                        |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| **运行时**         | **Bun 为主 + Node.js 保底**               | Bun 对 node-pty/better-sqlite3 兼容性已成熟 |
| **语言**           | **全栈 TypeScript**                       | Agent SDK / MCP SDK / 类型共享 / 前端统一   |
| **架构**           | **保持当前包拆分**                        | 比 Paseo 的单包多平台更清晰                 |
| **Paseo 代码**     | **不复制，学设计 + 用相同底层库**         | AGPL 传染性不可接受                         |
| **桌面端**         | **不做原生，可选 Tauri 壳或 Bun compile** | ROI 不够                                    |
| **iOS/macOS 原生** | **不做**                                  | Expo 覆盖 iOS，macOS 用 Web + CLI           |

---

## 二、架构优化

### 保持当前优势

```
FlowWhips 当前架构（比 Paseo 更清晰）:

shared/ (独立类型包)     ← Paseo 无此包，类型散落各处
  ├── types/
  ├── protocol/
  └── utils/

daemon/  (agent 管理)    ← Paseo 把 agent+auth+MCP 全塞 server
gateway/ (独立认证)      ← Paseo 内嵌在 server
relay/   (独立转发)      ← 类似
app/     (纯Web React)  ← Paseo 用 RN Web（性能受限）
mobile/  (独立Expo)      ← Paseo 同一个包
```

**不要合并成 Paseo 的单包结构。**

### 需要新增的模块

```
packages/
├── shared/          ✅ 已有，需扩展
│   └── src/
│       ├── types/          + 增加 WebSocket 二进制协议类型
│       ├── protocol/       + 增加 E2EE 握手协议
│       ├── crypto/         ← 从 daemon/crypto 提升到 shared
│       └── providers/      + 新增 provider registry 类型
│
├── daemon/          ✅ 已有，需大幅扩展
│   └── src/
│       ├── agent/
│       │   ├── adapter.ts       ✅ 保持
│       │   ├── manager.ts       ⟳ 重写为完整状态机
│       │   ├── claude-code.ts   ⟳ 改用 claude-agent-sdk
│       │   ├── codex.ts         ⟳ 改用 opencode-ai/sdk
│       │   └── opencode.ts      ⟳ 改用 SDK
│       ├── mcp/                 + 新增 MCP Server
│       │   ├── server.ts
│       │   └── tools/
│       ├── worktree/            + 新增 Git worktree 管理
│       ├── speech/              + 新增语音管道
│       │   ├── stt/
│       │   └── tts/
│       ├── scheduler/           + 新增定时任务
│       └── permissions/         + 新增 agent 权限
│
├── relay/           ⟳ 重写核心 — 加 E2EE
├── gateway/         ✅ 保持，小改动
├── app/             ✅ 保持，扩展功能
├── mobile/          ✅ 保持，扩展功能
├── cli/             ⟳ 重写 — 大幅扩充命令
└── shared/          ✅ 核心
```

---

## 三、实现路线图（按 ROI 排序）

### Phase 1 — 安全 & 基础（Week 1）

> 优先级最高，不补就是裸奔

| 任务                   | 做法                                                                | 库          | 工作量 |
| ---------------------- | ------------------------------------------------------------------- | ----------- | ------ |
| **E2E 加密 Relay**     | 学习 Paseo 的 NaCl box 设计，用 `tweetnacl` 实现                    | `tweetnacl` | 2 天   |
| **Agent 状态机**       | `starting → running → idle → error → stopped` + file-backed 持久化  | 无外部依赖  | 2 天   |
| **WebSocket 协议升级** | 二进制多路复用 (channel 0=control, 1=terminal) + Hello/Welcome 握手 | 无外部依赖  | 1 天   |

E2EE 实现要点：

```
握手:
  client → relay: { type: "hello", publicKey: nacl.box.keyPair().publicKey }
  daemon → relay: { type: "hello", publicKey: nacl.box.keyPair().publicKey }
  双方通过 relay 交换公钥 → ECDH 协商共享密钥

传输:
  每条消息 = nacl.box.encrypt(payload, nonce, receiverPubKey, senderSecrKey)
  relay 只看到密文 — 零知识
```

### Phase 2 — 核心 Agent 能力（Week 2）

| 任务               | 做法                                             | 库                                                   | 工作量 |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------- | ------ |
| **Agent SDK 集成** | 替换裸 `node-pty` spawn 为 SDK 结构化交互        | `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk` | 2 天   |
| **MCP Server**     | 实现 daemon 内置 MCP server，暴露 agent 控制工具 | `@modelcontextprotocol/sdk`                          | 2 天   |
| **QR 码配对**      | daemon 生成 QR → mobile 扫描 → 替代 6 位数字码   | `qrcode` + `expo-camera`                             | 1 天   |

MCP Server 设计：

```typescript
server.tool("agent_create", { provider, projectPath, prompt }, async (params) => {
  const sessionId = await agentManager.start(params);
  return { sessionId, status: "running" };
});
server.tool("agent_list", {}, async () => agentManager.list());
server.tool("agent_stop", { sessionId }, async ({ sessionId }) => agentManager.stop(sessionId));
server.tool("agent_send", { sessionId, message }, async ({ sessionId, message }) => {
  agentManager.write(sessionId, message);
});
server.tool("worktree_create", { basePath, branch }, async (params) => { ... });
server.tool("worktree_list", {}, async () => { ... });
```

### Phase 3 — CLI + Provider 系统（Week 3）

| 任务                     | 做法                                     | 工作量 |
| ------------------------ | ---------------------------------------- | ------ |
| **完整 CLI**             | Docker-style 命令设计                    | 3 天   |
| **自定义 Provider 系统** | `~/.flowwhips/providers.json` + zod 验证 | 2 天   |

CLI 目标命令集：

```bash
flowwhips daemon start/stop/status/pair
flowwhips agent ls/run/stop/attach/send/logs/inspect
flowwhips provider ls/models
flowwhips worktree ls/create/archive
flowwhips pipeline create/run/ls
```

Provider 配置设计（Zod 验证）：

```typescript
const ProviderConfigSchema = z.object({
  providers: z.record(
    z.object({
      type: z.enum(['claude-code', 'codex', 'opencode', 'custom']),
      binary: z.string().optional(),
      args: z.array(z.string()).default([]),
      env: z.record(z.string()).default({}),
      models: z.array(z.string()).optional(),
      profiles: z.record(z.object({})).optional(),
    }),
  ),
});
```

### Phase 4 — 差异化功能（Week 4-5）

| 任务             | 做法                                                        | 库                                            | 工作量 |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------- | ------ |
| **Git Worktree** | `git worktree add/list/remove` + per-worktree agent session | `isomorphic-git` 或裸 `git` CLI               | 3 天   |
| **语音管道**     | STT (Sherpa 本地 + Deepgram 云) + TTS (OpenAI API)          | `sherpa-onnx-node`, `@deepgram/sdk`, `openai` | 5 天   |
| **代码高亮**     | Lezer 语法高亮，用于 agent 输出的 diff/view                 | `@lezer/*`                                    | 3 天   |
| **桌面端**       | Tauri 壳包装 Web app，加托盘 + 通知 + 快捷键                | `tauri`                                       | 3-5 天 |

### Phase 5 — 完善（Week 6+，持续）

| 任务                   | 工作量 |
| ---------------------- | ------ |
| Agent 权限系统         | 2 天   |
| 定时任务 / Ralph Loop  | 2 天   |
| 推送通知               | 1 天   |
| 多主题 (dark/light)    | 2 天   |
| CI/CD (10 个 workflow) | 3 天   |
| Release 自动化         | 2 天   |
| Nix flake              | 1 天   |
| 编排 Skills 系统       | 3 天   |

---

## 四、相比 Paseo 的后发优势

| 方面            | Paseo 的做法         | FlowWhips 更优方案                          |
| --------------- | -------------------- | ------------------------------------------- |
| **运行时**      | Node.js              | ✅ Bun（启动快 5x，测试快 3x）              |
| **包管理**      | npm workspaces       | ✅ pnpm + Turborepo（更快）                 |
| **Server 框架** | Express              | ✅ Hono（更轻量，Bun 原生支持）             |
| **Web 端**      | React Native Web     | ✅ React 19 + Vite（原生 DOM 性能更好）     |
| **包结构**      | server 包含一切      | ✅ daemon/gateway/relay/shared 分离         |
| **类型安全**    | Zod 散落各处         | ✅ shared 包统一导出，Zod schema 派生类型   |
| **加密**        | NaCl box             | ✅ 同样用 NaCl（已经是最优解）              |
| **WebSocket**   | 自定义二进制多路复用 | ✅ 学 Paseo 的设计，用 Bun 内置 WS          |
| **配置**        | JSON config          | ✅ Zod 验证 + TypeScript config（类型安全） |
| **测试**        | Vitest               | ✅ `bun test`（更快）                       |
| **许可证**      | AGPL-3.0             | ✅ Apache-2.0（更宽松，商业友好）           |

---

## 五、桌面端 / 原生端决策

### iOS 原生 — 不做

Expo mobile 已覆盖 iOS，手机控制 agent 是低频操作（看 30 秒状态、发一条消息），Expo 够用。

### macOS 原生 SwiftUI — 不做

双技术栈成本太高，投入 3-4 个月换来 5% 用户在 5% 场景中稍好体验。

### macOS 桌面 — 可选 Tauri 壳

```
packages/desktop/
├── src-tauri/
│   ├── main.rs          # Rust 后端（托盘、文件拖拽、全局快捷键）
│   └── Cargo.toml
└── src/
    └── (复用 app/ 的 React 组件)

安装包: ~15MB（vs Electron 200MB）
内存:   ~50MB（vs Electron 500MB）
```

**优先级低，Phase 4+ 可选。**

### 最高性价比 — Bun compile 单二进制

```bash
bun build --compile ./src/index.ts --outfile flowwhips
# 用户: brew install flowwhips → flowwhips daemon start → 浏览器自动打开
```

零 GUI 开发成本，用户体验已经很好。
