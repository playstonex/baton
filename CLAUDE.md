# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FlowWhips is a remote AI agent orchestration platform — spawn, observe, and control coding agents (Claude Code, Codex, OpenCode) from a web UI, mobile app, or CLI. The daemon runs on the host, parses agent terminal output into structured events, and streams both raw PTY data and parsed events over WebSocket.

## Monorepo layout

pnpm workspaces + Turborepo. Packages live under `packages/*`:

| Package | Role | Dev runtime |
|---|---|---|
| `@flowwhips/shared` | Types, WS protocol, crypto, utils. Uses subpath exports (`./types`, `./protocol`, `./utils`, `./crypto`). | tsc only |
| `@flowwhips/daemon` | Host process. Agent adapters, parser, transport, file watcher, orchestrator, MCP, Rust PTY bridge. HTTP 3210 / WS 3211. | **Bun** |
| `@flowwhips/gateway` | JWT auth + 6-digit pairing. Uses `bun:sqlite`. Port 3220. | **Bun** |
| `@flowwhips/relay` | WS relay for remote access with E2E NaCl box encryption. Port 3230. | **Bun** |
| `@flowwhips/app` | React 19 + Vite web UI (xterm.js WebGL, Zustand, CodeMirror). Port 5173. | Node/Vite |
| `@flowwhips/cli` | `flowwhips` binary — `daemon/agent/provider/pipeline/worktree` subcommands. | Bun (dev) |
| `@flowwhips/mobile` | Expo RN app. **Not part of the Bun migration** — Expo toolchain stays on Node. | Expo/Node |

`extends/` contains reference projects (`paseo`, `lunel`, `open-claude-code`) for analysis only — not part of the build. The `paseo/CLAUDE.md` belongs to a different project; do not follow its rules here.

## Common commands

Always use `pnpm` (lockfile committed, `packageManager: pnpm@10.8.1`).

```bash
pnpm install                              # install all workspaces
pnpm build                                # turbo build (respects ^build deps)
pnpm typecheck                            # turbo typecheck across all packages
pnpm test                                 # vitest — note: daemon is excluded (needs Bun)
pnpm lint                                 # eslint packages/*/src
pnpm format                               # prettier write
pnpm --filter @flowwhips/<pkg> <script>   # target one package

# Single test file
pnpm vitest run packages/shared/src/__tests__/agent-state.test.ts

# Dev servers (run in separate terminals)
pnpm --filter @flowwhips/daemon dev       # requires Bun + built Rust PTY
pnpm --filter @flowwhips/app dev          # Vite, proxies /api → 3210, /ws → 3211
pnpm --filter @flowwhips/gateway dev
pnpm --filter @flowwhips/relay dev

# Build the Rust PTY binary (required before running daemon)
pnpm --filter @flowwhips/daemon build:pty
# → packages/daemon/pty/target/release/flowwhips-pty
```

### Runtime split (important)

- **Daemon / gateway / relay / cli** are authored for **Bun** (`bun:sqlite`, `Bun.serve`, `Bun.spawn`, `bun` imports). `pnpm --filter ... dev` runs them via `bun run --watch`. Do not swap to Node — the WebSocket server, SQLite, and PTY bridge all call Bun-specific APIs.
- **CI (`.github/workflows/ci.yml`)** runs on Node 22 and does **`pnpm build` + `pnpm typecheck` + `pnpm test` + `pnpm lint`** only. It does not start the daemon. `vitest.config.ts` excludes `packages/daemon/**` for this reason.
- **App / shared** are runtime-agnostic.
- **Release** (`.github/workflows/release.yml`) uses `bun build --compile` to produce standalone binaries for macOS-arm64 / linux-x64, and cross-compiles the Rust PTY per target.

## Architecture

```
Browser/Mobile ──WS──► Relay (3230) ──WS──► Daemon (3210/3211)
                          │                    │
                       Gateway (3220)       Rust PTY ──► agent CLI
                       JWT + pairing        (JSON-line stdio)
```

### Daemon internals (`packages/daemon/src`)

- `agent/` — `BaseAgentAdapter` subclasses per provider (`claude-code`, `claude-code-sdk`, `codex`, `opencode`). `createAdapter(type, mode)` picks PTY vs SDK; SDK mode uses `@anthropic-ai/claude-agent-sdk` when available.
- `agent/manager.ts` — `AgentManager` owns lifecycle. **State machine**: every transition goes through `transition()` which checks `VALID_TRANSITIONS` from shared. States: `starting → initializing → running → {idle, thinking, executing, waiting_input, error} → stopped`. Emits `status_change` events and persists snapshots to `$FLOWWHIPS_HOME/agents/<hash>/<id>.json` (default `~/.flowwhips`). On startup, `restore()` loads snapshots and forces any non-stopped agent to `stopped` (crash recovery).
- `pty/bridge.ts` — spawns the Rust PTY binary (`flowwhips-pty`) and talks to it over newline-delimited JSON on stdin/stdout. The bridge exposes an `IPty` interface (`write/resize/kill/onData/onExit`) that the manager treats opaquely. Expects the release binary at `pty/target/release/flowwhips-pty`.
- `parser/index.ts` — `ClaudeCodeParser.parse(raw)` strips ANSI then pattern-matches Claude Code's interactive output (tool-use markers `⏺/●/▸/→`, `Thinking…`, bash blocks, permission prompts, diffs, errors) into `ParsedEvent[]`. Raw PTY bytes are always preserved in `outputHistory` for terminal replay — parsing is additive, not destructive.
- `transport/index.ts` — `Bun.serve` WebSocket on port+1. Clients subscribe per-session via `control/attach_session`. On attach, the server replays full `outputHistory` + `eventHistory` so reconnections don't lose context.
- `transport/relay.ts` — outbound connection from daemon to a remote relay; forwards `ClientMessage` back to the local `AgentManager`.
- `orchestrator/index.ts` — sequential pipelines. Each step spawns an agent and polls until `status === 'stopped' | 'error'` before advancing.
- `watcher/index.ts` — chokidar file watcher per project, emits `file_change` ParsedEvents.
- `mcp/` — MCP server + client glue for exposing tools to agents.
- `worktree/` — git worktree helpers for isolated agent branches.

### Shared protocol (`packages/shared/src`)

- `types/` — `AgentProcess`, `AgentState` (discriminated union by status), `ParsedEvent` (union of `status_change | tool_use | file_change | command_exec | thinking | error | raw_output`), `AgentAdapter` interface.
- `protocol/` — `ClientMessage` (terminal_input, control) / `DaemonMessage` (terminal_output, parsed_event, status_update, agent_list, error). **Treat the WS protocol as a stable contract** — changing a field shape breaks older app/mobile clients.
- `crypto/` — tweetnacl wrappers: `generateKeyPair`, `deriveSharedKey`, `encrypt/decrypt` (xsalsa20-poly1305), `keyToFingerprint`. Used by relay for E2E encryption between host and client.
- `retry/`, `errors/`, `tools/`, `utils/` — misc helpers. `VALID_TRANSITIONS` (state machine map) also lives here.

Import from subpaths when you only need one area: `import { generateKeyPair } from '@flowwhips/shared/crypto'`.

### Web app (`packages/app/src`)

- `App.tsx` + `screens/` — React Router with Dashboard / Terminal / AgentDetail / Files / Pipelines / Settings.
- `services/websocket.ts` — singleton `wsService` (local vs relay modes). Auto-connects on mount.
- `stores/` — Zustand (`connection`, `events`).
- `components/` — xterm-based Terminal, EventTimeline, DiffViewer, CodeHighlighter (CodeMirror).

## Conventions

- **ESM everywhere.** All packages are `"type": "module"`. **Relative imports must include the `.js` extension** (e.g. `from './agent/manager.js'`) even for `.ts` sources — required by `moduleResolution: bundler` + ESM output.
- **TS strict** with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` (see `tsconfig.base.json`). Prefix intentionally-unused args with `_`.
- Prettier: 2-space, single quotes, semicolons, trailing commas, width 100.
- `noFallthroughCasesInSwitch` is on — close every `case` with `break` / `return`.
- Shared package is consumed via its **source** (no `dist/`): `"exports": "./src/index.ts"`. Do not add build output to its exports without also changing every dependent's tsconfig.
- Daemon tsconfig enables `types: ["node", "bun"]` — Bun-specific globals (`Bun.serve`, `Bun.spawn`, `bun:sqlite`) are expected in daemon/gateway/relay.

## Ports

| Service | Port |
|---|---|
| Daemon HTTP | 3210 |
| Daemon WS | 3211 |
| Gateway | 3220 |
| Relay | 3230 |
| Vite dev server | 5173 |

Freeing them during debugging: `lsof -ti:3210,3211,3220,3230,5173 | xargs kill`.

## Tests

- Vitest root config at `vitest.config.ts` picks up `packages/*/src/__tests__/**/*.test.ts`.
- **`packages/daemon/**` is excluded** because daemon tests exercise Bun APIs (`Bun.serve`, `bun:sqlite`) — running them under Node via `pnpm test` will fail. To run them locally: `bun test` inside `packages/daemon`.
- Shared tests cover the state machine (`agent-state.test.ts`), WS channels, NaCl crypto, handshake, delta encoding.

## Release artifacts

`v*` tag triggers `release.yml`:
- CLI → `bun build --compile` single-file binary (`flowwhips-<target>`).
- Daemon → `flowwhips-daemon` + `flowwhips-pty` tarballed together (Rust PTY compiled in the same job).
- Relay → compiled Bun binary.
- Android → `eas build --platform android --profile preview`.

Targets: `macos-arm64`, `linux-x64` (x64 macOS was intentionally removed — see commit `3d879ff`).
