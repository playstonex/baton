# FlowWhips 项目分析

## 一、项目定位

FlowWhips 是一个**开源的远程 AI Agent 编排平台**，允许用户通过手机或电脑浏览器远程控制宿主设备上运行的 AI 编码 Agent（Claude Code、Codex、OpenCode 等），实现随时随地的开发工作流。

### 核心价值主张

> **把 AI Agent 从本地工具变成可远程编排的服务，让开发者通过任何设备驱动 Agent 完成工作。**

### 与 Paseo 的核心差异

```
Paseo:     远程终端 → 看到 Agent 的字符输出
FlowWhips: 智能控制面板 → 理解 Agent 的行为，结构化展示，自动化编排
```

### 目标用户

| 用户类型 | 场景 |
|---------|------|
| 独立开发者 | 通勤时用手机审查 Agent 的代码变更，审批操作 |
| 小型团队 | 远程协作，共享 Agent 会话和项目上下文 |
| 技术主管 | 随时监控多个项目的 Agent 执行状态 |

---

## 二、竞品分析：Paseo

### Paseo 概述

- **仓库**：https://github.com/getpaseo/paseo
- **许可证**：AGPL-3.0-or-later
- **版本**：0.1.52（早期阶段，迭代非常快）
- **作者**：Mohamed Boudra
- **定位**：多平台 AI 编码 Agent 远程控制工具

### Paseo 技术栈

| 组件 | 技术 |
|------|------|
| Server/Daemon | Express + WebSocket + node-pty |
| 移动端 + Web | Expo SDK 54 / React Native 0.81.5 |
| 桌面端 | Electron 41 |
| CLI | Node.js（完整 CLI：run / ls / attach / send） |
| Relay | WebSocket 中继（E2EE，NAT 穿透） |
| 终端渲染 | xterm.js 全家桶（WebGL、Search、Clipboard 等） |
| Agent 协议 | ACP（@agentclientprotocol/sdk）+ MCP |
| 语音 | 本地优先（sherpa-onnx STT），可选 OpenAI / Deepgram |
| 状态管理 | Zustand |
| 构建 | npm workspaces monorepo（6 个核心包） |

### Paseo 的优势

1. **多平台客户端完整** — 手机、桌面、Web、CLI 四端齐全
2. **实时终端流** — node-pty + xterm.js 提供完整终端体验
3. **语音交互（本地优先）** — 默认本地 STT/TTS，可选云端 Provider
4. **多 Agent 支持** — Claude Code、Codex、OpenCode
5. **Agent 编排能力（实验性）** — `/paseo-handoff`（跨 Agent 交接）、`/paseo-loop`（循环验证）、`/paseo-orchestrator`（团队编排）
6. **Git Worktree 隔离** — Agent 在独立分支工作，不影响主目录
7. **完整 CLI** — `paseo run`、`paseo ls`、`paseo attach`、`paseo send`，支持远程 Daemon
8. **隐私优先** — 无遥测、无追踪、无强制登录
9. **开源社区基础** — 有一定 GitHub 关注度，作者活跃

### Paseo 的关键弱点

| 弱点 | 详细说明 | 影响 |
|------|---------|------|
| AGPL-3.0 许可证 | 衍生作品必须开源 | 限制二次开发和分发自由度 |
| 纯终端交互 | 客户端本质是"远程终端" | 用户体验停留在字符流层面，无结构化信息 |
| 无 Agent 输出解析 | 不理解 Agent 在做什么 | 无法展示文件变更、状态转换等结构化数据 |
| 编排 skills 不稳定 | 作者标注 "Unstable"，频繁变更 | 不可靠，且与作者个人环境耦合 |
| Monorepo 强耦合 | 包之间紧耦合 | 难以独立部署和扩展 |
| Relay 无消息持久化 | 断线后数据丢失 | 弱网环境体验差 |

### Paseo 的可借鉴之处

| 借鉴内容 | 理由 |
|---------|------|
| pty + WebSocket 核心架构 | 成熟可靠，是整个方案的基础 |
| xterm.js 终端渲染 | 业界标准，手机端也能用 |
| 多 Agent 抽象层（ACP） | 统一不同 Agent 的交互协议 |
| Expo 跨端方案 | 一套代码覆盖 iOS/Android/Web |
| 语音交互思路 | 差异化功能，提升移动端体验 |
| Git Worktree 隔离 | Agent 安全运行的好模式 |
| CLI 设计 | 完整的命令行工作流值得参考 |

### Paseo 不应借鉴之处

| 不借鉴内容 | 替代方案 |
|-----------|---------|
| AGPL 许可证 | Apache 2.0 |
| Electron 桌面端 | 暂不做桌面端，Web 优先 |
| 纯终端交互 | 结构化卡片 + 终端 + 语音 |
| npm workspaces monorepo | Turborepo + pnpm workspace |
| 不稳定的编排 skills | 从架构层面设计稳定的多 Agent 编排 |

---

## 三、市场机会

### 市场趋势

1. **AI Agent 爆发** — Claude Code、Codex、Cursor、Windsurf 等 Agent 层出不穷
2. **远程办公常态化** — 开发者需要在非办公环境继续驱动 Agent
3. **移动端生产力** — 开发者期望在手机上完成轻量级开发任务
4. **Agent 即服务** — 从本地工具向云端服务演进

### 竞争格局

| 产品 | 定位 | 不足 |
|------|------|------|
| Paseo | Agent 远程终端 | AGPL，纯终端，无结构化展示 |
| Cursor Remote | IDE 远程 | 仅限 Cursor，非通用 |
| GitHub Copilot Mobile | 代码补全 | 非 Agent，功能有限 |
| Replit Mobile | 云 IDE | 非原生 Agent 编排 |

### FlowWhips 的差异化切入点

1. **Agent 输出结构化解析** — 不只是看字符流，而是理解 Agent 在做什么（文件变更、命令执行、状态转换）
2. **智能控制面板** — 文件变更可视化、Diff 查看、Agent 状态实时面板
3. **稳定的多 Agent 编排** — 从架构层面支持，而非不稳定的 skills
4. **Apache 2.0 开源** — 更宽松的许可证，降低社区参与门槛

---

## 四、风险与挑战

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| Agent CLI 接口变更 | 中 | 抽象适配层，快速适配新版本 |
| Agent 输出解析复杂度 | 高 | 各 Agent 输出格式不统一且随版本变化；需要持续维护适配器，优先支持 Claude Code |
| 安全：远程代码执行 | 高 | Phase 1 仅局域网；Phase 2 加 E2EE；后续可选 Docker 沙箱 |
| 网络延迟影响体验 | 中 | 消息压缩、离线队列、局域网直连 |
| Agent 厂商自己做远程 | 高 | 专注多 Agent 通用编排，不与单一厂商竞争 |
| Paseo 快速迭代 | 中 | 聚焦结构化解析这个差异化点，不在终端体验上与 Paseo 正面竞争 |
| 开源社区接受度 | 低 | Apache 2.0 宽松许可证，降低门槛 |
