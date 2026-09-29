# 方案 A — Forge / PR 集成(GitHub 单家闭环)

> 目标:让 Baton 具备读取/操作远端托管平台(先 GitHub)的 PR、Issue、CI checks 与 checkout,
> 对齐 paseo 的 `ForgeRegistry` 能力。GitLab/Gitea 后补,不阻塞。
>
> 参考实现(已读源码):`extends/paseo/packages/server/src/services/forge-*.ts`、`github-service.ts`、`github-facts.ts`。
> Baton 现状:`packages/daemon/src/git/index.ts` 的 `GitService` 只有本地 `status/commit/push/pull/diff`,**无 forge 概念**。

## 1. 分层设计(照抄 paseo 的开放注册表模式)

```
packages/shared/src/forge/           # 中立数据模型 + 类型(新增 subpath 导出 ./forge)
  index.ts
  types.ts        PullRequestSummary / IssueSummary / PullRequestCheck / PullRequestCheckoutTarget
packages/daemon/src/forge/           # 服务实现
  registry.ts     ForgeRegistry(register/matchHost/probeHost/create)
  service.ts      ForgeService 接口
  github/
    service.ts    createGitHubService()  —— 用 gh CLI 或 REST/GraphQL
    facts.ts      host 匹配 / 探测(github.com + GHE)
packages/app/src/screens/
  PullRequests.tsx  新增 PR tab
```

## 2. shared 中立类型(直接照抄 paseo `forge-service.ts`)

```ts
// packages/shared/src/forge/types.ts
export interface PullRequestSummary {
  number: number; title: string; url: string; state: string;
  body: string | null; baseRefName: string; headRefName: string;
  labels: string[]; updatedAt: string; projectPath?: string;
}
export interface IssueSummary { /* 同结构,去掉 base/head */ }
export type PullRequestCheckStatus = 'pending' | 'success' | 'failure' | 'cancelled' | 'skipped';
export interface PullRequestCheck {
  name: string; status: PullRequestCheckStatus; url: string | null;
  workflow?: string; duration?: string; checkRunId?: number; workflowRunId?: number;
}
export interface PullRequestCheckoutTarget {
  number: number; baseRefName: string; headRefName: string;
  headOwnerLogin: string | null; headRepositorySshUrl: string | null;
  isCrossRepository: boolean;  // fork checkout(paseo #5221)
}
```
- 在 `packages/shared/package.json` 的 `exports` 加 `"./forge": "./src/forge/index.ts"`(与现有 `./crypto` 等一致)。

## 3. ForgeRegistry(照抄 paseo `forge-registry.ts` 精简版)

```ts
// packages/daemon/src/forge/registry.ts
export interface ForgeAdapterRegistration {
  createService: () => ForgeService;
  matchesHost?: (host: string) => boolean;
  probeHost?: (host: string) => Promise<boolean>;   // allSettled,抛错=不是本 forge
}
export class ForgeRegistry {
  register(forge, adapter): () => void
  matchHost(host): string | null                    // 多命中=歧义,返回 null
  async probeHost(host): Promise<string | null>      // Promise.allSettled
  create(forge): ForgeService | null
}
```
关键点(paseo 的设计意图,务必保留):`probeHost` 用 `Promise.allSettled` 而非 `all`——一个第三方探测抛错只表示「不是这个 forge」,不能让共享解析路径崩溃。

## 4. GitHub 适配器 —— 最省事路径:走 `gh` CLI

Baton 已经在 shell 里跑命令。用 `gh api` / `gh pr` 最快闭环,避免自己实现 OAuth/token 管理:
- `listPullRequests(repo)` → `gh pr list --json number,title,url,state,baseRefName,headRefName,labels,updatedAt`
- `getChecks(repo, pr)` → `gh pr checks <n> --json`
- `checkoutTarget(repo, pr)` → `gh pr view <n> --json headRefName,headRepository,isCrossRepository`
- host 匹配:`github.com` 精确 + GHE 走 `probeHost`(HEAD `/api/v3`)。

回退方案:若不想依赖 `gh`,用 REST/GraphQL + `Authorization: Bearer $GITHUB_TOKEN`,token 存 `$BATON_HOME/forge.json`(复用 `ProviderRegistry` 的 config-file 模式)。

## 5. daemon HTTP 路由(照 Hono 现有风格,与 `/api/git/*` 并列)

```ts
// packages/daemon/src/index.ts —— 与既有 app.get('/api/git/status') 同级
app.get('/api/forge/prs', async (c) => { /* repo=query → registry.matchHost → service.listPullRequests */ });
app.get('/api/forge/pr/:number/checks', async (c) => { ... });
app.post('/api/forge/pr/:number/checkout', async (c) => { ... });  // fork-aware
app.get('/api/forge/issues', async (c) => { ... });
```

## 6. app UI
- 新增 `packages/app/src/screens/PullRequests.tsx`,加进 `App.tsx` 路由(现有 screens 已有 `Git.tsx`,可复用其 data-fetch 风格)。
- PR checks 用 status → 颜色映射(pending/success/failure…)。
- MVP 不做「PR tab 自动打开(paseo #4956)」,先手动列表。

## 7. 落地顺序 & 首个 PR 范围
1. **PR#1**:shared 类型 + `exports` + `ForgeRegistry` + GitHub(gh CLI)service + 单测(matchHost 歧义、probeHost allSettled)。**不含 UI**——纯 daemon 能力,可 `curl /api/forge/prs` 验证。
2. **PR#2**:daemon HTTP 路由接通。
3. **PR#3**:app PullRequests screen。
4. 后续:GitLab / Gitea 适配器(各加一个 `ForgeAdapterRegistration`,不改注册表)。

## 8. 验证
- daemon 单测(Bun):`bun test` in `packages/daemon` 覆盖 registry 歧义/探测。
- 手测:`curl 'localhost:3210/api/forge/prs?repo=owner/name'`。
- `pnpm typecheck` + `pnpm lint`(CI 门槛)。

## 风险
- `gh` CLI 依赖:doctor 命令(`cli/commands/doctor.ts`)加一条 `gh` 存在性检查。
- rate limit:GitHub API 限流 → 缓存 + 复用 paseo 的 quota-fetcher 思路(可后置)。
