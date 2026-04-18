# 运行时选型分析：Node.js / Bun / Rust / Go

> 分析日期：2026-04-18

---

## 一、结论

**保持全栈 TypeScript，运行时从 Node.js 迁移到 Bun。**

不引入 Rust/Go，原因：

1. **瓶颈在 AI 推理，不在 daemon 性能** — agent 响应 5-120s，daemon 转发消息只需 0.1ms
2. **Agent SDK / MCP SDK 只有 TypeScript** — 换语言等于失去核心能力
3. **双栈维护成本 > 性能收益** — 一个人维护两个语言栈不可持续
4. **Paseo（标杆）用 Node.js** — 说明 Node.js 完全够用

---

## 二、Bun vs Node.js 可行性分析

### 硬阻断项：`node-pty`

`node-pty` 是 daemon 的核心依赖 — 负责 spawn agent 进程并捕获 PTY 输出。

| 状态                       | 说明                                              |
| -------------------------- | ------------------------------------------------- |
| Bun native addon 兼容层    | ⚠️ 实验性，需 `--experimental-native-builds` flag |
| `node-pty` 在 Bun 上的反馈 | 有人在 Bun 1.1+ 跑通，但不保证稳定                |

### 逐依赖 Bun 兼容性

| 依赖                    | 用途             | Bun 兼容性  | 备注                                |
| ----------------------- | ---------------- | ----------- | ----------------------------------- |
| **`node-pty`**          | Agent PTY spawn  | 🔴 需验证   | C++ addon                           |
| **`hono`**              | HTTP 框架        | ✅ 原生支持 | Bun 是 Hono 一等公民                |
| **`@hono/node-server`** | HTTP 适配层      | ⚠️ 可替换   | Bun 不需要此包                      |
| **`ws`**                | WebSocket        | ✅ 兼容     | Bun 有内置 `Bun.serve({websocket})` |
| **`better-sqlite3`**    | SQLite (gateway) | ⚠️ 实验性   | C++ addon，Bun 1.2+ 改善            |
| **`drizzle-orm`**       | ORM              | ✅ 纯 JS    | 完全兼容                            |
| **`jose`**              | JWT              | ✅ 纯 JS    | 使用 WebCrypto                      |
| **`chokidar`**          | 文件监控         | ✅ 纯 JS    | Bun 有内置 `Bun.file().watch()`     |
| **`crypto`**            | AES-256-GCM      | ✅ 内置     | Bun 实现了完整 `node:crypto`        |
| **`expo`**              | Mobile           | ✅ 不受影响 | Expo 有自己的 Metro bundler         |
| **`vite`**              | Web 构建         | ✅ 兼容     |                                     |
| **`tsx`**               | TS 运行          | ✅ 不需要   | Bun 原生跑 TS                       |
| **`turbo`**             | Monorepo         | ✅ 兼容     | 独立进程                            |

### 混合运行时策略

```
packages/
├── daemon/     → 🔴 可能需 Node.js (node-pty)
├── relay/      → ✅ Bun 最佳 (纯 ws)
├── gateway/    → ⚠️ 建议 Node.js (better-sqlite3)
├── app/        → ✅ Vite 不受影响 (浏览器端)
├── mobile/     → ✅ Expo 不受影响 (Metro)
├── cli/        → ✅ Bun 更快 (纯 ws + JSON)
└── shared/     → ✅ 都行 (纯 TS)
```

### Bun 迁移计划

**Phase 1 — 立即可做（无风险）**

| 改动                                  | 收益                |
| ------------------------------------- | ------------------- |
| 用 `bun run` 替代 `tsx`/`tsx watch`   | 启动快 3-5x         |
| `relay` 包用 Bun 运行 + `Bun.serve()` | WebSocket 吞吐 +30% |
| `cli` 包用 Bun 运行                   | 命令执行更快        |
| `bun test` 替代 vitest                | 测试更快            |

**Phase 2 — 验证后可做**

| 改动                     | 前提                                | 收益                       |
| ------------------------ | ----------------------------------- | -------------------------- |
| daemon 用 Bun 运行       | 验证 `node-pty` 在 Bun 上可用       | daemon 启动/热重载更快     |
| gateway 用 Bun 运行      | 验证 `better-sqlite3` 在 Bun 上可用 | gateway 更快               |
| 去掉 `@hono/node-server` | daemon/gateway 用 Bun 运行后        | 用 `Bun.serve()` 原生 HTTP |

**Phase 3 — 优化（远期）**

| 改动                                   | 收益          |
| -------------------------------------- | ------------- |
| `ws` 替换为 Bun 内置 WebSocket         | 减少 1 个依赖 |
| `chokidar` 替换为 `Bun.file().watch()` | 减少 1 个依赖 |
| Vite 替换为 `bun build`                | 构建更快      |

### 验证步骤

```bash
# 30 分钟快速验证
bun --version
cd packages/relay && bun src/index.ts      # 应该直接跑通
cd packages/cli && bun src/index.ts         # 应该直接跑通
cd packages/daemon && bun src/index.ts      # 关键：node-pty
cd packages/gateway && bun src/index.ts     # 关键：better-sqlite3
bun test                                    # 替代 vitest
```

---

## 三、Rust/Go 替代分析

### 为什么不建议换

#### 1. Agent SDK 生态 — TypeScript 完胜

```
@anthropic-ai/claude-agent-sdk    → JS/TS only
@opencode-ai/sdk                  → JS/TS only
@modelcontextprotocol/sdk         → JS/TS only (官方 SDK)
@agentclientprotocol/sdk          → JS/TS only
```

用 Rust/Go 重写意味着：

- 失去结构化 API，只能通过 CLI spawn + 文本 parse
- 失去类型安全的协议通信
- 需要自己实现底层 HTTP/WebSocket 协议调用

#### 2. 共享类型系统 — TypeScript 完胜

当前 FlowWhips 的 7 个包中，4 个必须是 TypeScript：

| 包              | 为什么必须 TS    |
| --------------- | ---------------- |
| `app` (React)   | 前端生态只有 TS  |
| `mobile` (Expo) | RN 生态只有 TS   |
| `cli`           | 依赖 shared 类型 |
| `shared`        | 类型定义         |

换成 Rust/Go 后需要维护两套协议定义，手动保持同步。

#### 3. 性能不是瓶颈

| 操作                  | Node.js 耗时 | Rust 耗时  | 用户感知差异 |
| --------------------- | ------------ | ---------- | ------------ |
| Spawn PTY 进程        | ~50ms        | ~30ms      | 无           |
| 转发 WebSocket 消息   | ~0.1ms       | ~0.05ms    | 无           |
| JWT 验证              | ~2ms         | ~0.5ms     | 无           |
| **AI agent 一次响应** | **5-120s**   | **5-120s** | **一样**     |

#### 4. Rust/Go 真正有优势的场景（FlowWhips 不需要）

| Rust/Go 优势   | FlowWhips 需要吗                  |
| -------------- | --------------------------------- |
| 百万级并发连接 | ❌ 几十个 agent 就够了            |
| 单二进制部署   | ⚠️ 不错，但 Bun compile 也能解决  |
| 极低延迟       | ❌ AI agent 响应 5-120s           |
| CPU 密集计算   | ❌ daemon 不做计算，只做 I/O 转发 |

### 如果未来真要换

唯一合理场景：**daemon 做成独立二进制发行**（用户 `brew install flowwhips` 不需要装 Node.js）。

路径：

```
现在：全部 TypeScript (最快开发)
  ↓
未来：Bun compile 把 daemon 编译成单二进制
  ↓
  或：只把 daemon 用 Go 重写（Go 的 PTY + WebSocket 生态成熟）
      其他包保持 TypeScript
```

这是远期的事，不在当前考虑范围内。
