# FlowWhips 项目计划

## 一、项目里程碑

```
Phase 0: 项目初始化                    Week 1-2
    │
Phase 1: 核心原型 — 本地模式 + 结构化解析  Week 3-6
    │
Phase 2: 远程连接 + Relay               Week 7-10
    │
Phase 3: 移动端 + 多 Agent + 智能化       Week 11-16
```

> **设计原则**：不做桌面客户端，不做商业化功能。聚焦开源工具本身的核心价值。

---

## Phase 0: 项目初始化（Week 1-2）

### 目标

搭建项目基础设施，确立开发规范。

### 任务清单

| # | 任务 | 优先级 | 预估工时 |
|---|------|--------|---------|
| 0.1 | 初始化 Turborepo + pnpm monorepo | P0 | 2h |
| 0.2 | 搭建 packages 结构（daemon / gateway / relay / app / shared） | P0 | 2h |
| 0.3 | 配置 TypeScript、ESLint、Prettier | P0 | 2h |
| 0.4 | 配置 GitHub Actions CI | P1 | 2h |
| 0.5 | 设计数据库 schema 并初始化 Drizzle（SQLite） | P0 | 3h |
| 0.6 | 搭建 API Gateway 骨架（Hono） | P0 | 3h |
| 0.7 | 搭建 Daemon 骨架（node-pty） | P0 | 4h |
| 0.8 | 搭建 Web 客户端骨架（React + Vite） | P0 | 3h |
| 0.9 | 编写 Agent Adapter 接口定义 + ParsedEvent 类型 | P0 | 2h |

### Monorepo 结构

```
FlowWhips/
├── docs/                          # 项目文档
├── packages/
│   ├── daemon/                    # 宿主守护进程
│   │   ├── src/
│   │   │   ├── agent/             # Agent 管理
│   │   │   │   ├── adapter.ts     # Agent 适配器接口
│   │   │   │   ├── claude-code.ts # Claude Code 适配器
│   │   │   │   ├── codex.ts       # Codex 适配器
│   │   │   │   └── manager.ts     # Agent 进程管理
│   │   │   ├── parser/            # 输出解析（核心差异化）
│   │   │   │   ├── base.ts        # 解析器基类
│   │   │   │   ├── claude-code.ts # Claude Code 输出解析
│   │   │   │   └── types.ts       # ParsedEvent 类型
│   │   │   ├── session/           # 会话管理
│   │   │   ├── transport/         # 通信层
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── gateway/                   # API 网关
│   │   ├── src/
│   │   │   ├── routes/            # API 路由
│   │   │   ├── middleware/        # 中间件（认证、限流）
│   │   │   ├── services/          # 业务逻辑
│   │   │   ├── db/                # 数据库（Drizzle + SQLite）
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── relay/                     # WebSocket 中继（Phase 2）
│   │   ├── src/
│   │   │   ├── connection.ts      # 连接管理
│   │   │   ├── forwarding.ts      # 数据转发
│   │   │   ├── encryption.ts      # E2EE
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── app/                       # Web 客户端（Phase 1）+ Mobile（Phase 3）
│   │   ├── src/
│   │   │   ├── screens/           # 页面
│   │   │   ├── components/        # 组件
│   │   │   ├── services/          # 客户端服务
│   │   │   ├── stores/            # Zustand 状态
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                    # 共享代码
│       ├── src/
│       │   ├── types/             # 类型定义（ParsedEvent 等）
│       │   ├── protocol/          # 通信协议
│       │   └── utils/             # 工具函数
│       ├── package.json
│       └── tsconfig.json
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### 交付物

- [x] 项目文档（docs/）
- [ ] 可编译运行的 monorepo 骨架
- [ ] CI pipeline 绿色通过
- [ ] 数据库 schema 定义
- [ ] Agent Adapter 接口 + ParsedEvent 类型定义

---

## Phase 1: 核心原型 — 本地模式 + 结构化解析（Week 3-6）

### 目标

实现最小可用产品：在局域网内通过 Web 浏览器控制宿主机上的 Claude Code，并提供结构化的 Agent 输出展示（核心差异化）。

### 核心功能

```
开发者电脑（宿主机）                    浏览器（同一局域网）
┌──────────────────┐                 ┌──────────────────────────┐
│  Daemon (HTTP+WS) │◀──WebSocket──▶│  Web App                 │
│  ├── Claude Code  │   直连模式      │  ├── xterm.js 终端       │
│  ├── node-pty     │                │  ├── Agent 状态面板       │
│  └── OutputParser │                │  ├── 文件变更列表         │
└──────────────────┘                 │  └── 结构化事件时间线     │
                                     └──────────────────────────┘
```

### 任务清单

| # | 任务 | 优先级 | 预估工时 |
|---|------|--------|---------|
| 1.1 | Daemon: Agent 进程启动/停止（node-pty） | P0 | 8h |
| 1.2 | Daemon: WebSocket Server 终端数据流 | P0 | 6h |
| 1.3 | Daemon: Claude Code 适配器（启动命令、环境变量） | P0 | 6h |
| 1.4 | Daemon: Claude Code 输出解析器（状态识别、工具调用、文件变更） | P0 | 10h |
| 1.5 | Daemon: 文件变更检测（chokidar） | P0 | 4h |
| 1.6 | Daemon: HTTP API（REST，端口发现） | P0 | 4h |
| 1.7 | Web App: xterm.js 终端组件 | P0 | 6h |
| 1.8 | Web App: Agent 启动/停止控制面板 | P0 | 4h |
| 1.9 | Web App: WebSocket 连接管理 + 重连 | P0 | 4h |
| 1.10 | Web App: Agent 状态面板（思考中/执行中/等待输入） | P0 | 4h |
| 1.11 | Web App: 结构化事件时间线组件 | P0 | 6h |
| 1.12 | Web App: 文件变更列表 + Diff 查看器 | P1 | 6h |
| 1.13 | 端到端测试：启动 Agent → 输入指令 → 看到结构化输出 | P0 | 4h |

### 验收标准

- [ ] 在宿主机启动 Daemon，指定项目路径
- [ ] 打开浏览器，看到 Agent 列表
- [ ] 点击"启动 Claude Code"，终端中出现 Claude Code 提示符
- [ ] 在浏览器中输入指令，Claude Code 正常响应
- [ ] Agent 状态实时更新（思考中 → 执行中 → 完成）
- [ ] Agent 修改文件后，自动展示文件变更列表
- [ ] 可查看文件 diff
- [ ] 可随时停止 Agent
- [ ] 刷新页面后自动重连

---

## Phase 2: 远程连接 + Relay（Week 7-10）

### 目标

突破局域网限制，通过 Relay 实现远程连接。移动端暂用 responsive Web 替代原生 App。

### 核心功能

```
手机浏览器（4G/5G）        Relay（公网）           宿主机（家里）
┌──────────────┐         ┌──────────┐          ┌──────────┐
│ Responsive   │◀─E2EE──▶│  Relay   │◀─WSS──▶│  Daemon  │
│ Web App      │  WSS     │  (NAT穿透)│          │          │
└──────────────┘         └──────────┘          └──────────┘
```

### 任务清单

| # | 任务 | 优先级 | 预估工时 |
|---|------|--------|---------|
| 2.1 | Relay: WebSocket 中继服务 | P0 | 8h |
| 2.2 | Relay: Host 注册与 Client 绑定 | P0 | 4h |
| 2.3 | Relay: 消息缓冲（Redis，断线恢复） | P0 | 4h |
| 2.4 | Daemon: Relay 连接 + 自动重连 | P0 | 4h |
| 2.5 | Daemon: 端到端加密（X25519 + AES-256-GCM） | P0 | 6h |
| 2.6 | Daemon: 设备配对（QR Code / Token 交换） | P0 | 4h |
| 2.7 | Web App: 远程连接模式 | P0 | 4h |
| 2.8 | Web App: Responsive 适配（移动端浏览器可用） | P0 | 6h |
| 2.9 | 认证系统：JWT Token 签发与验证 | P0 | 4h |
| 2.10 | Gateway: 认证 API | P0 | 3h |
| 2.11 | 消息压缩（终端输出 delta 压缩） | P1 | 4h |

### 验收标准

- [ ] 手机浏览器在 4G 网络下连接到家里的 Daemon
- [ ] 终端交互流畅，延迟 < 300ms
- [ ] 断网后重连，终端状态恢复
- [ ] 通信端到端加密
- [ ] 结构化事件在移动端浏览器正常展示
- [ ] 设备配对流程顺畅（扫码或输入 Token）

---

## Phase 3: 移动端 + 多 Agent + 智能化（Week 11-16）

### 目标

推出原生移动端，支持多种 Agent，增强智能化能力。

### 核心功能

| 功能 | 说明 |
|------|------|
| Expo 原生移动端 | iOS/Android 原生 App，推送通知 |
| Codex 适配器 | 支持 OpenAI Codex |
| OpenCode 适配器 | 支持 OpenCode |
| 多宿主机管理 | 一个账户注册多台电脑 |
| 项目文件浏览器 | 在手机上浏览项目文件树 |
| 多 Agent 并行 | 同时运行多个 Agent，独立会话 |
| Agent 编排（基础） | Agent 间任务交接 |

### 任务清单

| # | 任务 | 优先级 | 预估工时 |
|---|------|--------|---------|
| 3.1 | 移动端: Expo 项目搭建 + 终端组件 | P0 | 8h |
| 3.2 | 移动端: Agent 控制界面 + 结构化事件展示 | P0 | 6h |
| 3.3 | 移动端: 推送通知（Agent 完成/出错） | P0 | 4h |
| 3.4 | Daemon: Codex 适配器 + 输出解析 | P0 | 8h |
| 3.5 | Daemon: OpenCode 适配器 + 输出解析 | P1 | 8h |
| 3.6 | Gateway: 多宿主机管理 API | P1 | 4h |
| 3.7 | Web + Mobile: 项目文件浏览器 | P1 | 6h |
| 3.8 | Web + Mobile: 多 Agent 并行管理界面 | P0 | 6h |
| 3.9 | Daemon: 基础 Agent 编排（任务交接） | P2 | 8h |
| 3.10 | CLI: 基础命令行工具（start / ls / attach / send） | P1 | 6h |

### 验收标准

- [ ] iOS/Android App 可从应用商店安装
- [ ] 手机收到 Agent 任务完成推送通知
- [ ] 同时管理 Claude Code 和 Codex 两个 Agent
- [ ] Agent 状态实时更新（思考中 → 执行中 → 完成）
- [ ] 浏览宿主机上的项目文件
- [ ] CLI 可启动和管理 Agent

---

## 二、团队与资源

### 最小团队（Phase 0-2）

| 角色 | 人数 | 职责 |
|------|------|------|
| 全栈工程师 | 1-2 | Daemon + Gateway + Web 客户端 |

### 扩展团队（Phase 3）

| 角色 | 人数 | 职责 |
|------|------|------|
| 移动端工程师 | +1 | Expo 移动端 |

---

## 三、技术决策记录

### 决策 1: Hono vs Express

- **选择**: Hono
- **理由**: 性能优于 Express 3-5x，TypeScript 原生支持，兼容 Edge Runtime
- **风险**: 生态不如 Express 成熟，但本项目不需要大量中间件

### 决策 2: 暂不做桌面客户端

- **选择**: 不做 Desktop（Tauri / Electron）
- **理由**: 减少开发范围，Web 客户端已覆盖桌面场景；移动端通过 Expo 覆盖
- **后续**: 如有强需求，可在 Phase 3 之后考虑 Tauri 2.0

### 决策 3: Expo vs React Native CLI

- **选择**: Expo SDK 54（Phase 3）
- **理由**: Paseo 已验证 Expo 方案的可行性，一套代码覆盖 iOS/Android/Web
- **风险**: 原生模块兼容性（xterm.js 需要 WebView 方案）

### 决策 4: SQLite vs PostgreSQL

- **选择**: SQLite（Phase 1-2），可选迁移 PostgreSQL
- **理由**: 零运维，嵌入 Daemon 进程，自部署场景最简单；Drizzle 支持无缝切换
- **风险**: 并发写入受限，但单用户/小团队场景足够

### 决策 5: 结构化解析提前到 Phase 1

- **选择**: Phase 1 即实现 Claude Code 输出解析
- **理由**: 这是与 Paseo 的核心差异化，越早验证越好；如果只做远程终端，没有存在价值
- **风险**: Agent 输出格式不稳定，需要持续维护

### 决策 6: Apache 2.0 许可证

- **选择**: Apache 2.0
- **理由**: 比 AGPL 宽松，提供专利保护，降低社区参与门槛
- **风险**: 无明显风险

---

## 四、风险缓解

| 风险 | 缓解策略 |
|------|---------|
| Agent CLI 破坏性更新 | 适配器模式隔离变更；每个 Agent 有独立的适配器和解析器 |
| Agent 输出格式不稳定 | Phase 1 优先支持 Claude Code；解析器设计为可降级（解析失败时回退到原始终端流） |
| 安全漏洞（远程代码执行） | Phase 1 仅局域网；Phase 2 加 E2EE + 设备配对 |
| 移动端终端体验差 | Phase 2 先用 responsive Web 验证；Phase 3 原生 App 可用结构化卡片替代终端 |
| 延迟过高影响体验 | 局域网直连 + Relay 消息压缩 + 断线缓冲 |
| Paseo 快速迭代 | 聚焦结构化解析差异化，不在终端体验上正面竞争 |

---

## 五、成功指标

### Phase 1 完成时

- 能在浏览器中远程使用 Claude Code
- Agent 输出结构化展示（状态、文件变更、工具调用）
- 端到端延迟 < 100ms（局域网）

### Phase 2 完成时

- 手机浏览器可远程控制宿主机 Agent
- 通信端到端加密
- 断线重连 < 5s
- GitHub Star 50+

### Phase 3 完成时

- 原生移动端 App 上线
- 支持 3 种以上 Agent
- CLI 工具可用
- GitHub Star 200+
