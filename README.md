# FlowWhips

Open-source remote AI Agent orchestration platform — control Claude Code, Codex, and OpenCode from your phone or browser.

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────┐
│  Web / Phone │◄──────────────────►│  Relay   │
│  (React App) │                    │ (port    │
└──────────────┘                    │  3230)   │
                                    └────┬─────┘
                                         │
                                    ┌────▼─────┐
                                    │ Gateway  │
                                    │ (auth,   │
                                    │  JWT)    │
                                    └────┬─────┘
                                         │
                                    ┌────▼─────┐
                                    │  Daemon  │
                                    │ (agents, │
                                    │  parser) │
                                    └──────────┘
```

**Daemon** runs on the host machine, spawning agent CLIs via `node-pty`. It parses their output into structured events (tool use, file changes, thinking state, errors) and streams them over WebSocket.

**Relay** is an optional WebSocket relay for remote access — connects your phone/browser to the daemon over the internet.

**Gateway** handles JWT authentication and 6-digit device pairing codes.

**Web App** provides a dashboard, live terminal (xterm.js WebGL), file browser, and pipeline orchestration UI.

## Packages

| Package | Description |
|---|---|
| `shared` | Core types, WebSocket protocol, utilities |
| `daemon` | Host process — agent adapters, output parser, transport, file watcher |
| `relay` | WebSocket relay for remote connections |
| `gateway` | Auth service — JWT, pairing codes, SQLite |
| `app` | React web UI — dashboard, terminal, files, pipelines |
| `cli` | Terminal CLI — `flowwhips start/ls/attach/send/stop` |

## Quick Start

```bash
# Clone
git clone https://github.com/playstonex/flowwhips.git
cd flowwhips

# Install
pnpm install

# Build all packages
pnpm build

# Start daemon (spawns agents on your machine)
pnpm --filter @flowwhips/daemon dev

# Start web app (in another terminal)
pnpm --filter @flowwhips/app dev

# Open http://localhost:5173
```

## CLI

```bash
# Start an agent
flowwhips start /path/to/project
flowwhips start /path/to/project --agent codex

# List running agents
flowwhips ls

# Attach to agent terminal
flowwhips attach <session-id>

# Send input
flowwhips send <session-id> "fix the bug"

# Stop an agent
flowwhips stop <session-id>
```

## Pipeline Orchestration

Chain agents sequentially — when one finishes, the next starts automatically:

```bash
# Via API
curl -X POST http://localhost:3210/api/pipelines \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "review-and-fix",
    "steps": [
      {"id": "s1", "agentType": "claude-code", "projectPath": "/my-project"},
      {"id": "s2", "agentType": "codex", "projectPath": "/my-project"}
    ]
  }'
```

Or use the **Pipelines** tab in the web UI.

## Tech Stack

- **Runtime**: Node.js 22, TypeScript, ESM
- **Monorepo**: pnpm workspaces + Turborepo
- **Daemon**: Hono, node-pty, chokidar, ws
- **Web App**: React 19, Vite, xterm.js (WebGL), Zustand
- **Auth**: JWT (jose), 6-digit pairing codes
- **Database**: SQLite (Drizzle ORM, better-sqlite3)
- **Crypto**: AES-256-GCM

## License

Apache-2.0
