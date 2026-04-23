# FlowWhips 实施计划

> 日期：2026-04-22
> 版本：v1.0

---

## 当前代码库状态

### Agent Adapter 实现

| 文件 | 描述 | 模式 |
|------|------|------|
| `adapter.ts` | `BaseAgentAdapter` 抽象基类 | PTY |
| `claude-code.ts` | Claude Code PTY 适配器 | PTY |
| `codex.ts` | Codex PTY 适配器 | PTY |
| `opencode.ts` | OpenCode PTY 适配器 | PTY |
| `claude-sdk.ts` | Claude Agent SDK 适配器 | SDK |
| `manager.ts` | Agent 生命周期管理 | - |
| `registry.ts` | Provider 配置注册表 | - |

### 现有接口

```typescript
// packages/shared/src/types/index.ts
interface AgentAdapter {
  readonly name: string;
  readonly agentType: AgentType;
  detect(projectPath: string): boolean;
  buildSpawnConfig(config: AgentConfig): SpawnConfig;
  parseOutput(raw: string): ParsedEvent[];
}

interface SdkAgentAdapter extends AgentAdapter {
  isSdkAvailable(): boolean;
  startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }>;
}
```

### 系统监控现状

- **无现有实现**
- 仅使用 `node:os` 获取 hostname/networkInterfaces
- `/api/host` 端点返回基础信息，无 metrics

---

## 实施任务

### Task 1: Agent Provider 统一接口

**目标**: 统一 Claude Code / Codex / OpenCode 适配器接口

**现有问题**:
- PTY 适配器和 SDK 适配器接口不一致
- 各 adapter 的 `parseOutput` 逻辑分散
- 缺少统一的 session 管理

**设计**:
```typescript
interface AgentProvider {
  // 元数据
  readonly name: string;
  readonly type: AgentType;
  
  // 检测
  detect(projectPath: string): boolean;
  isAvailable(): boolean;
  
  // Session 管理
  createSession(config: AgentConfig): Promise<AgentSession>;
  
  // 事件订阅
  subscribe(handler: (event: ParsedEvent) => void): () => void;
}

interface AgentSession {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  stop(): Promise<void>;
}
```

**文件变更**:
- `packages/shared/src/types/agent.ts` - 新增 AgentProvider 接口
- `packages/daemon/src/agent/provider.ts` - 实现类
- `packages/daemon/src/agent/claude-code.ts` - 重构为 Provider
- `packages/daemon/src/agent/codex.ts` - 重构为 Provider
- `packages/daemon/src/agent/opencode.ts` - 重构为 Provider
- `packages/daemon/src/agent/manager.ts` - 使用 Provider

**工作量**: 2-3 天

---

### Task 2: 系统监控 Dashboard

**目标**: 在 Dashboard 显示宿主机状态

**功能**:
- CPU 使用率
- 内存使用率
- 磁盘使用率
- 系统运行时间

**架构**:
```
Daemon                      App
  │                          │
  ├─ /api/system/stats ◄─────┤ fetch()
  │     {                    │
  │       cpu: number,        │
  │       memory: {          │
  │         used: number,     │
  │         total: number    │
  │       },                 │
  │       disk: {            │
  │         used: number,    │
  │         total: number    │
  │       },                 │
  │       uptime: number      │
  │     }                    │
```

**文件变更**:
- `packages/shared/src/types/system.ts` - 新增类型
- `packages/daemon/src/system/stats.ts` - 新增监控服务
- `packages/daemon/src/index.ts` - 注册路由
- `packages/app/src/components/SystemStats.tsx` - 新增组件
- `packages/app/src/screens/Dashboard.tsx` - 集成组件

**工作量**: 2-3 天

---

### Task 3: Session Grace Period

**目标**: 断连后自动恢复

**功能**:
- 保存 session 状态到文件
- 断连后 N 分钟内自动重连
- 恢复时重新 attach 到同一 session

**文件变更**:
- `packages/shared/src/types/session.ts` - 新增类型
- `packages/daemon/src/session/persistence.ts` - 新增
- `packages/daemon/src/session/reconnect.ts` - 新增

**工作量**: 1 天

---

## 实施顺序

| 顺序 | 任务 | 依赖 | 预估 |
|------|------|------|------|
| 1 | Agent Provider 接口 | 无 | 2-3 天 |
| 2 | 系统监控 | 无 | 2-3 天 |
| 3 | Session Grace Period | Task 1 | 1 天 |

---

## 总结

优先实施 **Agent Provider 接口统一**，因为：
1. 改动现有代码，重构后更清晰
2. 为后续功能打下基础
3. 工作量适中

系统监控是完全新增的功能，不影响现有逻辑，可并行或后续实施。
