# 方案 C — 插件系统(先 Provider 插件,UI 贡献层后置)

> 目标:让第三方扩展 Baton。**范围决策**:先做「provider 插件」(第三方 agent 适配器),
> 因为 Baton 的 adapter registry 已是天然插件点,成本最低、无需 esbuild;
> 「UI 贡献 / RPC / 分发」是完整插件平台,重、后置。
>
> 参考实现(已读源码):`extends/paseo/packages/plugin/src/contracts.ts`、`rpc.ts`、
> `server/src/server/plugins/compiler.ts`(esbuild 打包)。
> Baton 现状:`agent/index.ts` 的 `createAdapter` 用**静态 map** 硬编码 6 个适配器;有 MCP 但无第三方扩展机制。

## 阶段一:Provider 插件(推荐先做)

### 现状痛点
`packages/daemon/src/agent/index.ts`:
```ts
const adapters: Record<string, new () => BaseAgentAdapter> = {
  'claude-code': ClaudeCodeAdapter, codex: CodexAdapter, 'kiro-cli': ..., opencode: ...,
};   // ← 加一个 provider = 改这个文件 + 重新编译。第三方无法注入。
```

### 改造:开放注册表(照 paseo ForgeRegistry 的开放边界思路)
```ts
// packages/daemon/src/agent/adapter-registry.ts
class AdapterRegistry {
  register(type: string, ctor: new () => BaseAgentAdapter): () => void
  create(type): BaseAgentAdapter | null
  has(type): boolean
  ids(): string[]
}
// 内置 6 个默认注册进去;createAdapter() 改为查 registry 而非静态 map。
```

### 第三方 provider 加载
- 约定目录:`$BATON_HOME/plugins/<name>/`,每个含 `plugin.json`(manifest)+ 编译好的 JS。
- manifest 声明 `kind: 'provider'` + `type`(如 `my-agent`)+ 入口。
- daemon 启动时扫描该目录 → 动态 `import()` → `registry.register(type, exportedAdapter)`。
- **安全边界**:provider 插件运行在 daemon 进程内,必须是 **本机用户显式放入**(不做自动下载),对齐「never install without being asked」原则。

### 首个 PR 范围
1. `AdapterRegistry` + `createAdapter` 改为查注册表(内置行为不变,纯重构 + 单测)。
2. `$BATON_HOME/plugins/` 扫描 + 动态注册。
3. doctor 命令列出已加载的第三方 provider。

验证:放一个最小 `echo` provider 到 `$BATON_HOME/plugins/`,`baton agent list` 能看到其 type,能 spawn。

---

## 阶段二:UI 贡献 + RPC(后置,重)

> 仅在阶段一验证价值后再投入。以下是 paseo 的完整形态,供路线图参考。

### 契约快照层(paseo `contracts.ts`)
插件只吃**稳定快照**,不碰内部结构:
- `PluginWorkspaceSnapshot` / `PluginAgentSnapshot`(status/model/labels/attentionReason…)
- `PluginTheme` / `PluginThemeColors`(与 Baton 主题变量对齐)
- 贡献点:主题、附件源、workspace 面板、settings、buttons、`PluginTimelineItem` 渲染。

Baton 要先定义这套快照类型(从现有 `AgentState`/`AgentProcess` 投影出稳定子集),否则插件会耦合内部结构、每次改内部就破坏插件。

### RPC(paseo `rpc.ts`)
`defineRpc` / `defineSettings` 声明式契约,client 调用 → server 执行跨进程。Baton 可复用现有 WS `ClientMessage`/`DaemonMessage` 协议扩展一个 `plugin_rpc` 通道。

### 打包(paseo `compiler.ts`)
esbuild 把插件源打成 client-only / server-only bundle,heartbeat lease 管生命周期。**这是最重的一块**——需要引入 esbuild 到 daemon,处理 asar unpacked 二进制路径等。Baton 无 Electron,路径问题小,但依然是大工程。

### 分发(paseo v0.9.0)
npm 安装(scoped/版本/tag/range)、`plugin update --all/--check/--yes`、Settings→Plugins 显示 source+revision。可最后做。

---

## 总结与建议
| 阶段 | 内容 | 成本 | 建议 |
|---|---|---|---|
| 一 | Provider 插件(开放 AdapterRegistry + 本地目录加载) | 低 | **先做,ROI 高** |
| 二a | 契约快照层 + RPC 通道 | 中 | 阶段一验证后 |
| 二b | esbuild 打包 + npm 分发 | 高 | 最后,或长期不做 |

Baton 的差异化优势:无 Electron,插件打包不必处理 asar/unpacked 二进制(paseo 的 `compiler.ts` 大半篇幅在处理这个),阶段二b 反而比 paseo 简单。

## 验证(阶段一)
- daemon 单测:AdapterRegistry register/create/歧义。
- 手测:最小第三方 provider 落盘 → spawn 成功。
- `pnpm typecheck` + `pnpm lint`。
