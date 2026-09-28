# 方案 B — 多 daemon / 多主机

> 目标:一个 Baton 客户端连接多台 daemon(本地 + 远程),每台主机有独立命名空间;
> 并让一个 agent 会话能在另一台 daemon 上驱动 agent(对齐 paseo #5392)。
>
> 参考实现(已读源码):`extends/paseo/packages/app/src/types/host-connection.ts`、
> `plugins/hosts/index.ts`、路由 `app/src/app/h/[serverId]/…`、MCP 工具 `server/agent/tools/paseo-tools.ts` 的 `send_agent_prompt`。
> Baton 现状:`transport/relay.ts` 仅单向 host 转发(`hostId` + `role=host`),UI/store 全是**隐式单机**假设。**这是本方案最重的部分。**

## 1. HostProfile 模型(照抄 paseo `host-connection.ts`)

```ts
// packages/shared/src/host/types.ts  (新增 exports "./host")
export type HostConnection =
  | { id; type: 'directTcp'; host; port }
  | { id; type: 'directSocket'; path }        // unix sock
  | { id; type: 'directPipe'; path }          // win named pipe
  | { id; type: 'remoteSsh'; host; sshPort?; daemonPort? }
  | { id; type: 'relay'; relayEndpoint; useTls?; daemonPublicKeyB64 };  // ← Baton relay 已具备 E2E

export interface HostProfile {
  serverId: string; label: string;
  connections: HostConnection[];
  preferredConnectionId: string | null;
  createdAt: string; updatedAt: string;
}
```
**Baton 的优势**:`relay` 连接形态的 E2E(`daemonPublicKeyB64`)已经存在于 `transport/relay.ts` + `@baton/shared/crypto`,直接复用,不用重写加密。

## 2. 客户端连接池(照抄 paseo `plugins/hosts/index.ts`)

```ts
// packages/app/src/services/host-pool.ts
class HostPool {
  // 每个在线主机维护一条 WS(复用现有 services/websocket.ts 的 wsService,改成可多实例)
  getHosts(): { serverId; label }[]
  getSnapshot(serverId): { connectionStatus: 'online'|'offline'; client } | null
  getClient(serverId): DaemonClient   // 掉线/换连接时用 AbortController 回收
  subscribeAll(listener): () => void
}
```
现有 `services/websocket.ts` 是**单例 `wsService`**——本方案的核心改造点:把它从「一个全局连接」改成「按 serverId 索引的连接集合」。

## 3. serverId 命名空间(app 路由 + store)

paseo 把整个 app 挂在 `h/[serverId]/…` 下。Baton 用 React Router,等价改造:
- 路由前缀:`/h/:serverId/terminal`、`/h/:serverId/agent/:id` …(现有 screens 不变,只加一层 param)。
- Zustand store(`stores/connection`、`stores/events`)从「单连接状态」改为「按 serverId 分片」。
- 本地 daemon 作为一个隐式 `serverId='local'`,**向后兼容**:无 serverId 时默认路由到 local。

## 4. 跨主机跑 agent(#5392)—— MCP 工具

paseo 的 `send_agent_prompt`(`paseo-tools.ts`)按 `agentId` 寻址目标 agent:
- agent-scoped 调用默认 `background=true`;顶层调用默认阻塞等待。
- 阻塞超时(paseo 30s,#5347)→ 转 finish-notification,不丢结果。

Baton 落地:在 `packages/daemon/src/mcp/tools/` 加 `send_agent_prompt` 工具:
```ts
send_agent_prompt({ agentId, prompt, background?, notifyOnFinish? })
  → agentManager.get(agentId) → 写入 prompt → (background ? 立即返回 : waitForAgentWithTimeout)
```
跨 daemon 寻址:agentId 需带 serverId 前缀或由 HostPool 解析到对应 client。

## 5. 落地顺序 & 首个 PR 范围
1. **PR#1(纯类型,零风险)**:shared 加 `HostProfile`/`HostConnection` + `exports "./host"` + 单测。
2. **PR#2(客户端池,最大改造)**:`wsService` 单例 → HostPool 多实例。**这是硬骨头**,建议单独一个 PR,先让「local + 一个远程」两台跑通。
3. **PR#3(UI 命名空间)**:路由加 `:serverId`,store 分片,本地兼容 `serverId='local'`。
4. **PR#4(跨主机 agent)**:MCP `send_agent_prompt` 工具 + finish-notification。

## 6. 验证
- 两台 daemon:本机 3210 + 另起一台(或 relay 连远程),客户端同时列出两台的 agents。
- 跨主机:在 A 的 agent 会话里 `send_agent_prompt` 驱动 B 的 agent,确认结果回传。
- `pnpm typecheck` + `pnpm lint`。

## 风险 / 注意
- **单例 `wsService` 是全项目最大耦合点**——先审计所有 `import { wsService }` 的调用点,评估改造面(建议先做这一步的调研 PR)。
- SSH 连接形态(`remoteSsh`)需要 SSH 隧道到 daemonPort,MVP 可先只做 `directTcp` + `relay` 两种,SSH 后补。
- 认证:每台主机独立 gateway JWT / 配对,HostProfile 要能存 per-host 凭据引用(不存明文)。
