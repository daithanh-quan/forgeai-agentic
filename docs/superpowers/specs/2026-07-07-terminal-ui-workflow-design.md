# Terminal UI Workflow Monitor — Design Spec

**Date:** 2026-07-07
**Phase:** 9
**Status:** Approved

## Overview

A standalone terminal UI watcher (`forgeai-init --watch`) that displays the
ForgeAI orchestration workflow in real-time. When the user prompts a task,
the TUI shows which agents are working, their status, reviewer progress, and
check results — all in a single screen with zero persistence.

---

## Section 1: Architecture

```
┌─────────────────────────────────────────────────────┐
│  Terminal A (orchestrator)                          │
│  $ claude "build feature X"                         │
│    → emits NDJSON events to named pipe              │
└─────────────────────┬───────────────────────────────┘
                      │  NDJSON events (newline-delimited JSON)
                      ▼
┌─────────────────────────────────────────────────────┐
│  Terminal B (TUI watcher)                           │
│  $ forgeai-init --watch                             │
│    → reads named pipe                               │
│    → renders Ink dashboard                          │
└─────────────────────────────────────────────────────┘
```

**Communication:** Named pipe (FIFO) at `.forgeai.pipe` in the current working
directory. The TUI creates the pipe on startup and blocks reading. The
orchestrator detects the pipe and writes events to it. No sockets, no server,
no file persistence.

**Startup order:** TUI must start first (creates the pipe), orchestrator
connects any time after. If the TUI is not running, the orchestrator skips
pipe writes silently (pipe existence check before each write).

**Pipe location override:**
```bash
FORGEAI_PIPE=/tmp/myproject.pipe forgeai-init --watch
```

---

## Section 2: Event Protocol

All events are NDJSON — one JSON object per line, UTF-8.

### Event Types

```jsonc
// Orchestrator lifecycle
{ "type": "orchestrator.start", "task": "Build auth module", "ts": 1720000000 }
{ "type": "orchestrator.done",  "status": "success", "ts": 1720000080 }

// Agent lifecycle
{ "type": "agent.assigned", "agentId": "codex-1", "role": "implementer", "task": "Write src/auth.ts", "ts": 1720000003 }
{ "type": "agent.progress", "agentId": "codex-1", "message": "Writing src/auth.ts...", "ts": 1720000010 }
{ "type": "agent.done",     "agentId": "codex-1", "status": "success", "ts": 1720000060 }

// Reviewer lifecycle
{ "type": "review.start", "agentId": "reviewer-1", "target": "codex-1", "ts": 1720000061 }
{ "type": "review.done",  "agentId": "reviewer-1", "status": "pass", "ts": 1720000070 }

// Check lifecycle
{ "type": "check.run",    "name": "security", "status": "running", "ts": 1720000070 }
{ "type": "check.result", "name": "security", "status": "pass",    "ts": 1720000075 }
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event category (see above) |
| `agentId` | string | Unique agent identifier (e.g. `codex-1`, `agy-2`) |
| `role` | string | `implementer`, `docs`, `reviewer`, `orchestrator` |
| `task` | string | Human-readable task description |
| `message` | string | Progress message from agent |
| `status` | string | `running`, `success`, `fail`, `pass`, `warning` |
| `name` | string | Check name (e.g. `security`, `memory`, `codegraph`) |
| `target` | string | agentId being reviewed |
| `ts` | number | Unix timestamp (seconds) |

### Status Values

| Value | Icon | Color |
|-------|------|-------|
| `running` | `⟳` (animated) | yellow |
| `success` / `pass` | `✓` | green |
| `fail` | `✗` | red |
| `warning` | `⚠` | yellow |
| `pending` | `○` | dim |

---

## Section 3: UI Layout

```
╔══════════════════════════════════════════════════════════════╗
║  ForgeAI Orchestration Monitor          ● LIVE  07/07 14:32 ║
╠══════════════════════════════════════════════════════════════╣
║  TASK                                                        ║
║  > "Build feature X — auth module with JWT"                  ║
╠══════════════════════╦═══════════════════════════════════════╣
║  AGENTS              ║  ACTIVITY LOG                         ║
║                      ║                                       ║
║  ⟳ orchestrator      ║  14:32:01  orchestrator started       ║
║    decomposing...    ║  14:32:03  assigned codex-1 → impl    ║
║                      ║  14:32:05  assigned agy-1 → docs      ║
║  ✓ agy-1  [docs]     ║  14:32:40  agy-1 completed            ║
║    done in 35s       ║  14:32:41  reviewer-1 reviewing...    ║
║                      ║  14:33:10  ✓ review passed            ║
║  ⟳ codex-1  [impl]   ║  14:33:11  ⟳ security check...       ║
║    Writing auth.ts   ║  14:33:14  ✓ security passed          ║
║                      ║  14:33:15  ⟳ memory check...         ║
║  ⟳ reviewer-1        ║                                       ║
║    reviewing codex-1 ║                                       ║
╠══════════════════════╩═══════════════════════════════════════╣
║  CHECKS                                                      ║
║  ✓ security   ✓ memory   ⟳ codegraph   ○ approval           ║
╠══════════════════════════════════════════════════════════════╣
║  [Q] quit   [C] clear log   [↑↓] scroll log                 ║
╚══════════════════════════════════════════════════════════════╝
```

**Panels:**

- **Header** — connection status (`● LIVE` / `○ WAITING` / `⚠ DISCONNECTED`), current time
- **Task bar** — active task name from `orchestrator.start` event
- **Agents** (left, 24 cols) — one `AgentCard` per `agentId`, updates in place
- **Activity Log** (right, remaining width) — append-only event stream, scrollable with `↑↓`
- **Check bar** (bottom) — inline status for each check in `--check-all` sequence
- **Key hints** — always visible at the very bottom

---

## Section 4: Ink Components & Data Flow

### Component Tree

```
<App>
  <Header />
  <TaskBar />
  <Box flexDirection="row">
    <AgentPanel>
      <AgentCard /> × N
    </AgentPanel>
    <ActivityLog />
  </Box>
  <CheckBar />
  <KeyBindings />
```

### State Shape

```ts
type AgentStatus = 'pending' | 'running' | 'success' | 'fail'
type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'warning'

type AgentState = {
  agentId: string
  role: string
  task: string
  status: AgentStatus
  message: string
  startedAt: number
  doneAt?: number
}

type LogEntry = {
  ts: number
  text: string
  level: 'info' | 'warn' | 'error'
}

type AppState = {
  connected: boolean
  task: string | null
  agents: Record<string, AgentState>
  logs: LogEntry[]
  checks: Record<string, CheckStatus>
}
```

### Data Flow

```
named pipe (NDJSON)
  → readline interface
  → JSON.parse per line
  → dispatch(event) into useReducer
  → AppState updates
  → Ink re-renders affected components
```

- `useEffect` on mount: create/open pipe, attach readline
- `useInput` for keyboard shortcuts (`q`, `c`, `↑`, `↓`)
- Single `useReducer` in `<App>` — no external state library

### Reducer Cases

| Event type | State mutation |
|------------|---------------|
| `orchestrator.start` | set `task`, set `connected = true` |
| `orchestrator.done` | update orchestrator agent status |
| `agent.assigned` | add entry to `agents` with `status: running` |
| `agent.progress` | update `agents[id].message` |
| `agent.done` | update `agents[id].status`, set `doneAt` |
| `review.start` | add reviewer agent card |
| `review.done` | update reviewer status |
| `check.run` | set `checks[name] = 'running'` |
| `check.result` | set `checks[name]` to result status |
| unknown type | append raw line to logs as `warn` |

---

## Section 5: Error Handling & Edge Cases

### Pipe not yet created (orchestrator not started)

TUI shows `○ WAITING` in header with a help message. TUI creates the pipe
itself on startup, so it is always ready before the orchestrator connects.

### Pipe disconnected mid-run (orchestrator crash)

- Header switches to `⚠ DISCONNECTED`
- Log appends: `[!] Connection lost — waiting for reconnect`
- TUI does not exit. State from before disconnect is preserved and readable.
- When the orchestrator restarts and reconnects, header returns to `● LIVE`

### Malformed JSON line

- Silently skipped (no crash)
- One dim log entry: `[warn] malformed event skipped`

### Unknown event type

- Appended to activity log as raw text (not dropped)
- Helps debug orchestrator-side changes during development

### Clean exit (`Q`)

- Pipe file removed from disk
- Ink unmounts cleanly
- Terminal restored to normal state

---

## Section 6: File Structure

```
bin/
  forgeai-init.ts          ← add --watch flag routing
  ui/
    App.tsx                ← root component, reducer, pipe setup
    Header.tsx             ← connection status + clock
    TaskBar.tsx            ← active task display
    AgentPanel.tsx         ← agent list container
    AgentCard.tsx          ← single agent status card
    ActivityLog.tsx        ← scrollable log panel
    CheckBar.tsx           ← inline check status row
    KeyBindings.tsx        ← key hint footer
    pipe.ts                ← named pipe reader utility
    types.ts               ← AppState, AgentState, Event types
```

## Section 7: Dependencies

Add to `dependencies` (runtime, not dev — needed in published bin):

```json
"ink": "^5.0.0",
"react": "^18.0.0"
```

Add to `devDependencies`:

```json
"@types/react": "^18.0.0"
```

`tsx` already in devDependencies handles JSX/TSX compilation.

---

## Acceptance Criteria

- [ ] `forgeai-init --watch` starts TUI and shows `○ WAITING`
- [ ] When orchestrator emits `orchestrator.start`, header switches to `● LIVE` and task name appears
- [ ] Each `agent.assigned` event adds a new agent card
- [ ] `agent.progress` updates the card message in place
- [ ] `agent.done` updates icon to `✓` or `✗` with elapsed time
- [ ] `check.run` / `check.result` update the check bar inline
- [ ] Activity log scrolls with `↑↓`
- [ ] `C` clears the log
- [ ] `Q` exits cleanly and removes pipe file
- [ ] Malformed JSON does not crash the TUI
- [ ] Disconnection shows `⚠ DISCONNECTED` without exiting
