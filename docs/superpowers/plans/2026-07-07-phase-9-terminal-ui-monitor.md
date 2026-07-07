# Phase 9 — Terminal UI Workflow Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `forgeai-init --watch` — a standalone Ink TUI that shows the ForgeAI orchestration workflow in real-time (agents, reviewer, checks) by reading NDJSON events from a named pipe; and `forgeai-init --emit '<json>'` for the orchestrator to write events into that pipe.

**Architecture:** Named pipe (FIFO) at `.forgeai.pipe` (overridable via `FORGEAI_PIPE` env). TUI opens the pipe with `O_RDWR` — this keeps the write end open so the readline stream never receives EOF when individual `--emit` calls disconnect. All UI state lives in a single `useReducer` inside `<App>`. No file persistence.

**Tech Stack:** Ink v5, React 18, TypeScript with `react-jsx`, Node.js built-in `fs`/`readline`/`net`, Node built-in test runner.

## Global Constraints

- Node.js `>=18.18.0` (project requirement); tested on v20.
- ESM project (`"type": "module"`) — all internal imports must use `.js` extension even for `.ts`/`.tsx` source files.
- `NodeNext` module resolution — `import 'ink'` resolves from `node_modules`, no `.js` needed for third-party packages.
- Tests run with: `node --import tsx --test test/*.test.ts` — test files must be `.ts`, not `.tsx` (glob won't match `.tsx`). Import `.tsx` components as `.js` in test files.
- TypeScript strict mode. No `any` without a cast comment.
- Never place credentials in repo files.
- `npm run typecheck` and `npm run build` must pass after every task.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `tsconfig.json` | Add `jsx`, `jsxImportSource`, add `**/*.tsx` to include |
| Modify | `tsconfig.build.json` | Add `**/*.tsx` to include |
| Modify | `bin/lib/context.ts` | Export `watch`, `emit`, `emitPayload` flags |
| Modify | `bin/forgeai-init.ts` | Route `--watch` → `runWatch`, `--emit` → `runEmit` |
| Create | `bin/ui/types.ts` | All shared types: `AppState`, `AgentState`, `ForgeEvent`, etc. |
| Create | `bin/ui/pipe.ts` | Named pipe FIFO reader + `emitToPipe` writer |
| Create | `bin/ui/reducer.ts` | Pure `reducer(state, event): AppState` |
| Create | `bin/ui/Header.tsx` | Connection status + clock |
| Create | `bin/ui/TaskBar.tsx` | Active task display |
| Create | `bin/ui/AgentCard.tsx` | Single agent status card |
| Create | `bin/ui/AgentPanel.tsx` | Agent list container |
| Create | `bin/ui/ActivityLog.tsx` | Scrollable event log |
| Create | `bin/ui/CheckBar.tsx` | Inline check status row |
| Create | `bin/ui/KeyBindings.tsx` | Key hint footer |
| Create | `bin/ui/App.tsx` | Root component: pipe reader + reducer + useInput |
| Create | `bin/lib/watch.tsx` | `runWatch()` — renders `<App />` |
| Create | `bin/lib/emit.ts` | `runEmit()` — writes one event to pipe |
| Create | `test/pipe.test.ts` | Tests for pipe reader + emitter |
| Create | `test/ui-reducer.test.ts` | Tests for every reducer case |

---

### Task 1: Setup — Dependencies + tsconfig + types

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`
- Create: `bin/ui/types.ts`

**Interfaces:**
- Produces: `AppState`, `AgentState`, `AgentStatus`, `CheckStatus`, `LogEntry`, `ForgeEvent` — used by all later tasks.

- [ ] **Step 1: Install runtime dependencies**

```bash
npm install ink react
npm install --save-dev @types/react ink-testing-library
```

Expected: packages appear in `package.json` dependencies / devDependencies.

- [ ] **Step 2: Update `tsconfig.json` for JSX**

Current `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["bin/**/*.ts", "templates/**/*.ts", "test/**/*.ts"]
}
```

Replace with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": [
    "bin/**/*.ts",
    "bin/**/*.tsx",
    "templates/**/*.ts",
    "test/**/*.ts"
  ]
}
```

- [ ] **Step 3: Update `tsconfig.build.json` to include `.tsx` files**

Current:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "bin",
    "outDir": "dist",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["bin/**/*.ts"]
}
```

Replace with:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "bin",
    "outDir": "dist",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["bin/**/*.ts", "bin/**/*.tsx"]
}
```

- [ ] **Step 4: Create `bin/ui/types.ts`**

```ts
export type AgentStatus = 'pending' | 'running' | 'success' | 'fail';
export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'warning';

export type AgentState = {
  agentId: string;
  role: string;
  task: string;
  status: AgentStatus;
  message: string;
  startedAt: number;
  doneAt?: number;
};

export type LogEntry = {
  ts: number;
  text: string;
  level: 'info' | 'warn' | 'error';
};

export type AppState = {
  connected: boolean;
  task: string | null;
  agents: Record<string, AgentState>;
  logs: LogEntry[];
  checks: Record<string, CheckStatus>;
};

export type ForgeEvent = {
  type: string;
  ts: number;
  agentId?: string;
  role?: string;
  task?: string;
  message?: string;
  status?: string;
  name?: string;
  target?: string;
  raw?: string;
};
```

- [ ] **Step 5: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: exits with code 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.build.json bin/ui/types.ts package.json package-lock.json
git commit -m "feat(ui): setup Ink deps, JSX tsconfig, shared types"
```

---

### Task 2: Named Pipe I/O — `bin/ui/pipe.ts` + `test/pipe.test.ts`

**Files:**
- Create: `bin/ui/pipe.ts`
- Create: `test/pipe.test.ts`

**Interfaces:**
- Produces:
  - `getPipePath(): string`
  - `createPipeReader(pipePath: string, onLine: (line: string) => void): () => void`
  - `emitToPipe(pipePath: string, json: string): void`

- [ ] **Step 1: Write the failing test**

Create `test/pipe.test.ts`:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPipeReader, emitToPipe } from '../bin/ui/pipe.js';

test('pipe reader receives lines emitted by emitToPipe', async () => {
  const pipePath = path.join(os.tmpdir(), `forgeai-test-${Date.now()}`);
  const received: string[] = [];

  const cleanup = createPipeReader(pipePath, (line) => received.push(line));

  emitToPipe(pipePath, '{"type":"agent.assigned","ts":1}');
  emitToPipe(pipePath, '{"type":"agent.done","ts":2}');

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(received, [
    '{"type":"agent.assigned","ts":1}',
    '{"type":"agent.done","ts":2}',
  ]);

  cleanup();
  assert.ok(!fs.existsSync(pipePath), 'cleanup must remove pipe file');
});

test('emitToPipe throws when pipe does not exist', () => {
  assert.throws(
    () => emitToPipe('/tmp/nonexistent-forgeai.pipe', '{}'),
    /not running/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --import tsx --test test/pipe.test.ts
```

Expected: FAIL — `Cannot find module '../bin/ui/pipe.js'`

- [ ] **Step 3: Implement `bin/ui/pipe.ts`**

```ts
import { execSync } from 'node:child_process';
import fs, { constants } from 'node:fs';
import readline from 'node:readline';

const DEFAULT_PIPE = '.forgeai.pipe';

export function getPipePath(): string {
  return process.env['FORGEAI_PIPE'] ?? DEFAULT_PIPE;
}

export function createPipeReader(
  pipePath: string,
  onLine: (line: string) => void,
): () => void {
  try {
    execSync(`mkfifo "${pipePath}"`);
  } catch {
    // FIFO already exists — ok
  }

  // O_RDWR: TUI holds both read and write ends open.
  // This prevents EOF when individual --emit writers disconnect.
  const fd = fs.openSync(pipePath, constants.O_RDWR);
  const readStream = fs.createReadStream(pipePath, { fd, autoClose: false });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  rl.on('line', (line) => {
    if (line.trim()) onLine(line.trim());
  });

  return () => {
    rl.close();
    readStream.destroy();
    fs.closeSync(fd);
    try {
      fs.unlinkSync(pipePath);
    } catch {
      // already gone — ok
    }
  };
}

export function emitToPipe(pipePath: string, json: string): void {
  if (!fs.existsSync(pipePath)) {
    throw new Error(
      `ForgeAI TUI is not running. Start with: forgeai-init --watch`,
    );
  }
  const fd = fs.openSync(pipePath, constants.O_WRONLY);
  const buf = Buffer.from(json + '\n');
  fs.writeSync(fd, buf);
  fs.closeSync(fd);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --import tsx --test test/pipe.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add bin/ui/pipe.ts test/pipe.test.ts
git commit -m "feat(ui): named pipe reader and emitter with O_RDWR hold"
```

---

### Task 3: State Reducer — `bin/ui/reducer.ts` + `test/ui-reducer.test.ts`

**Files:**
- Create: `bin/ui/reducer.ts`
- Create: `test/ui-reducer.test.ts`

**Interfaces:**
- Consumes: `AppState`, `AgentState`, `ForgeEvent`, `CheckStatus` from `bin/ui/types.js`
- Produces:
  - `initialState(): AppState`
  - `reducer(state: AppState, event: ForgeEvent): AppState`

- [ ] **Step 1: Write failing tests**

Create `test/ui-reducer.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from '../bin/ui/reducer.js';

const ts = 1_000;

test('initialState returns empty state', () => {
  const s = initialState();
  assert.equal(s.connected, false);
  assert.equal(s.task, null);
  assert.deepEqual(s.agents, {});
  assert.deepEqual(s.logs, []);
  assert.deepEqual(s.checks, {});
});

test('orchestrator.start sets task and connected=true', () => {
  const s = reducer(initialState(), { type: 'orchestrator.start', task: 'Build X', ts });
  assert.equal(s.connected, true);
  assert.equal(s.task, 'Build X');
  assert.equal(s.logs.length, 1);
  assert.ok(s.logs[0]!.text.includes('orchestrator'));
});

test('agent.assigned adds agent with running status', () => {
  const s = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'Write auth.ts', ts,
  });
  assert.ok(s.agents['codex-1']);
  assert.equal(s.agents['codex-1']!.status, 'running');
  assert.equal(s.agents['codex-1']!.role, 'implementer');
  assert.equal(s.logs.length, 1);
});

test('agent.progress updates message without adding agent', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'x', ts,
  });
  const s = reducer(base, {
    type: 'agent.progress', agentId: 'codex-1', message: 'Writing auth.ts...', ts,
  });
  assert.equal(s.agents['codex-1']!.message, 'Writing auth.ts...');
  assert.equal(Object.keys(s.agents).length, 1);
});

test('agent.done marks success and sets doneAt', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'x', ts,
  });
  const s = reducer(base, { type: 'agent.done', agentId: 'codex-1', status: 'success', ts: ts + 30 });
  assert.equal(s.agents['codex-1']!.status, 'success');
  assert.equal(s.agents['codex-1']!.doneAt, ts + 30);
});

test('agent.done with fail status marks fail', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'agy-1', role: 'docs', task: 'x', ts,
  });
  const s = reducer(base, { type: 'agent.done', agentId: 'agy-1', status: 'fail', ts: ts + 10 });
  assert.equal(s.agents['agy-1']!.status, 'fail');
});

test('review.start adds reviewer agent card', () => {
  const s = reducer(initialState(), {
    type: 'review.start', agentId: 'reviewer-1', target: 'codex-1', ts,
  });
  assert.ok(s.agents['reviewer-1']);
  assert.equal(s.agents['reviewer-1']!.role, 'reviewer');
  assert.equal(s.agents['reviewer-1']!.status, 'running');
});

test('review.done marks reviewer done', () => {
  const base = reducer(initialState(), {
    type: 'review.start', agentId: 'reviewer-1', target: 'codex-1', ts,
  });
  const s = reducer(base, { type: 'review.done', agentId: 'reviewer-1', status: 'pass', ts: ts + 5 });
  assert.equal(s.agents['reviewer-1']!.status, 'success');
});

test('check.run sets check to running', () => {
  const s = reducer(initialState(), { type: 'check.run', name: 'security', status: 'running', ts });
  assert.equal(s.checks['security'], 'running');
});

test('check.result sets check to result status', () => {
  const base = reducer(initialState(), { type: 'check.run', name: 'security', status: 'running', ts });
  const s = reducer(base, { type: 'check.result', name: 'security', status: 'pass', ts });
  assert.equal(s.checks['security'], 'pass');
});

test('_clear_log empties log array', () => {
  const base = reducer(initialState(), { type: 'orchestrator.start', task: 'x', ts });
  assert.ok(base.logs.length > 0);
  const s = reducer(base, { type: '_clear_log', ts });
  assert.equal(s.logs.length, 0);
});

test('unknown event type appends warn log entry', () => {
  const s = reducer(initialState(), { type: 'some.unknown.event', ts, raw: 'raw line here' });
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0]!.level, 'warn');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --import tsx --test test/ui-reducer.test.ts
```

Expected: FAIL — `Cannot find module '../bin/ui/reducer.js'`

- [ ] **Step 3: Implement `bin/ui/reducer.ts`**

```ts
import type { AgentState, AgentStatus, AppState, CheckStatus, ForgeEvent, LogEntry } from './types.js';

export function initialState(): AppState {
  return {
    connected: false,
    task: null,
    agents: {},
    logs: [],
    checks: {},
  };
}

function appendLog(state: AppState, text: string, ts: number, level: LogEntry['level'] = 'info'): AppState {
  return { ...state, logs: [...state.logs, { ts, text, level }] };
}

function toAgentStatus(s: string | undefined): AgentStatus {
  if (s === 'success' || s === 'pass') return 'success';
  if (s === 'fail') return 'fail';
  return 'running';
}

function toCheckStatus(s: string | undefined): CheckStatus {
  if (s === 'pass') return 'pass';
  if (s === 'fail') return 'fail';
  if (s === 'warning') return 'warning';
  if (s === 'running') return 'running';
  return 'pending';
}

export function reducer(state: AppState, event: ForgeEvent): AppState {
  const { ts } = event;

  switch (event.type) {
    case 'orchestrator.start':
      return appendLog(
        { ...state, connected: true, task: event.task ?? null },
        'orchestrator started',
        ts,
      );

    case 'orchestrator.done':
      return appendLog(state, `orchestrator ${event.status ?? 'done'}`, ts);

    case 'agent.assigned': {
      const id = event.agentId!;
      const agent: AgentState = {
        agentId: id,
        role: event.role ?? 'agent',
        task: event.task ?? '',
        status: 'running',
        message: 'assigned',
        startedAt: ts,
      };
      return appendLog(
        { ...state, agents: { ...state.agents, [id]: agent } },
        `assigned ${id} → ${event.role ?? 'agent'}`,
        ts,
      );
    }

    case 'agent.progress': {
      const id = event.agentId!;
      const existing = state.agents[id];
      if (!existing) return state;
      return {
        ...state,
        agents: { ...state.agents, [id]: { ...existing, message: event.message ?? '' } },
      };
    }

    case 'agent.done': {
      const id = event.agentId!;
      const existing = state.agents[id];
      if (!existing) return state;
      return appendLog(
        {
          ...state,
          agents: {
            ...state.agents,
            [id]: { ...existing, status: toAgentStatus(event.status), doneAt: ts },
          },
        },
        `${id} ${event.status ?? 'done'}`,
        ts,
      );
    }

    case 'review.start': {
      const id = event.agentId!;
      const agent: AgentState = {
        agentId: id,
        role: 'reviewer',
        task: `reviewing ${event.target ?? ''}`,
        status: 'running',
        message: `reviewing ${event.target ?? ''}`,
        startedAt: ts,
      };
      return appendLog(
        { ...state, agents: { ...state.agents, [id]: agent } },
        `reviewer ${id} reviewing ${event.target ?? ''}`,
        ts,
      );
    }

    case 'review.done': {
      const id = event.agentId!;
      const existing = state.agents[id];
      if (!existing) return state;
      return appendLog(
        {
          ...state,
          agents: {
            ...state.agents,
            [id]: { ...existing, status: toAgentStatus(event.status), doneAt: ts },
          },
        },
        `review ${event.status ?? 'done'}`,
        ts,
      );
    }

    case 'check.run':
      return appendLog(
        { ...state, checks: { ...state.checks, [event.name!]: 'running' } },
        `⟳ ${event.name} check...`,
        ts,
      );

    case 'check.result': {
      const status = toCheckStatus(event.status);
      const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '⚠';
      return appendLog(
        { ...state, checks: { ...state.checks, [event.name!]: status } },
        `${icon} ${event.name} ${event.status ?? ''}`,
        ts,
      );
    }

    case '_clear_log':
      return { ...state, logs: [] };

    default:
      return appendLog(
        state,
        event.raw ?? `[warn] unknown event: ${event.type}`,
        ts,
        'warn',
      );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --import tsx --test test/ui-reducer.test.ts
```

Expected: 12 passing tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add bin/ui/reducer.ts test/ui-reducer.test.ts
git commit -m "feat(ui): state reducer with full event coverage and tests"
```

---

### Task 4: Ink UI Components

**Files:**
- Create: `bin/ui/Header.tsx`
- Create: `bin/ui/TaskBar.tsx`
- Create: `bin/ui/AgentCard.tsx`
- Create: `bin/ui/AgentPanel.tsx`
- Create: `bin/ui/ActivityLog.tsx`
- Create: `bin/ui/CheckBar.tsx`
- Create: `bin/ui/KeyBindings.tsx`

**Interfaces:**
- Consumes: `AppState`, `AgentState`, `CheckStatus`, `LogEntry` from `bin/ui/types.js`
- Produces: Named React components, each imported by `App.tsx` in Task 5.

- [ ] **Step 1: Create `bin/ui/Header.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';

type Props = { connected: boolean };

export function Header({ connected }: Props) {
  const now = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const icon = connected ? '●' : '○';
  const label = connected ? 'LIVE' : 'WAITING';
  const color = connected ? 'green' : 'gray';

  return (
    <Box paddingX={1} justifyContent="space-between" borderStyle="single">
      <Text bold>ForgeAI Orchestration Monitor</Text>
      <Text color={color}>
        {icon} {label}  {now}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 2: Create `bin/ui/TaskBar.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';

export function TaskBar({ task }: { task: string | null }) {
  return (
    <Box paddingX={2}>
      {task ? (
        <Text>
          <Text dimColor>{'> '}</Text>
          <Text>"{task}"</Text>
        </Text>
      ) : (
        <Text dimColor>Waiting for task...</Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Create `bin/ui/AgentCard.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';
import type { AgentState } from './types.js';

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '⟳',
  success: '✓',
  fail: '✗',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  success: 'green',
  fail: 'red',
};

export function AgentCard({ agent }: { agent: AgentState }) {
  const icon = STATUS_ICON[agent.status] ?? '?';
  const color = STATUS_COLOR[agent.status] ?? 'white';
  const detail =
    agent.doneAt !== undefined
      ? `done in ${agent.doneAt - agent.startedAt}s`
      : agent.message;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={color}>{icon} </Text>
        <Text bold>{agent.agentId}</Text>
        <Text dimColor>  [{agent.role}]</Text>
      </Text>
      <Text dimColor>  {detail}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Create `bin/ui/AgentPanel.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';
import { AgentCard } from './AgentCard.js';
import type { AgentState } from './types.js';

export function AgentPanel({ agents }: { agents: Record<string, AgentState> }) {
  const list = Object.values(agents);

  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        AGENTS
      </Text>
      {list.length === 0 ? (
        <Text dimColor>No agents yet...</Text>
      ) : (
        list.map((a) => <AgentCard key={a.agentId} agent={a} />)
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Create `bin/ui/ActivityLog.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';
import type { LogEntry } from './types.js';

const LEVEL_COLOR: Record<string, string> = {
  info: 'white',
  warn: 'yellow',
  error: 'red',
};

const MAX_VISIBLE = 20;

export function ActivityLog({
  logs,
  scrollOffset,
}: {
  logs: LogEntry[];
  scrollOffset: number;
}) {
  const start = Math.max(0, logs.length - MAX_VISIBLE + scrollOffset);
  const visible = logs.slice(start, start + MAX_VISIBLE);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold underline>
        ACTIVITY LOG
      </Text>
      {visible.map((entry, i) => {
        const time = new Date(entry.ts * 1000).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return (
          <Text key={i} color={LEVEL_COLOR[entry.level] ?? 'white'}>
            <Text dimColor>{time}  </Text>
            {entry.text}
          </Text>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 6: Create `bin/ui/CheckBar.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';
import type { CheckStatus } from './types.js';

const CHECK_ICON: Record<CheckStatus, string> = {
  pending: '○',
  running: '⟳',
  pass: '✓',
  fail: '✗',
  warning: '⚠',
};

const CHECK_COLOR: Record<CheckStatus, string> = {
  pending: 'gray',
  running: 'yellow',
  pass: 'green',
  fail: 'red',
  warning: 'yellow',
};

export function CheckBar({ checks }: { checks: Record<string, CheckStatus> }) {
  const entries = Object.entries(checks);

  return (
    <Box paddingX={1} borderStyle="single">
      <Text bold>CHECKS  </Text>
      {entries.length === 0 ? (
        <Text dimColor>No checks run yet</Text>
      ) : (
        entries.map(([name, status]) => (
          <Text key={name} color={CHECK_COLOR[status]}>
            {CHECK_ICON[status]} {name}{'   '}
          </Text>
        ))
      )}
    </Box>
  );
}
```

- [ ] **Step 7: Create `bin/ui/KeyBindings.tsx`**

```tsx
import { Box, Text } from 'ink';
import React from 'react';

export function KeyBindings() {
  return (
    <Box paddingX={1}>
      <Text dimColor>[Q] quit   [C] clear log   [↑↓] scroll log</Text>
    </Box>
  );
}
```

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 9: Commit**

```bash
git add bin/ui/Header.tsx bin/ui/TaskBar.tsx bin/ui/AgentCard.tsx bin/ui/AgentPanel.tsx bin/ui/ActivityLog.tsx bin/ui/CheckBar.tsx bin/ui/KeyBindings.tsx
git commit -m "feat(ui): Ink dashboard components — Header, TaskBar, agents, log, checks"
```

---

### Task 5: App Root — `bin/ui/App.tsx`

**Files:**
- Create: `bin/ui/App.tsx`

**Interfaces:**
- Consumes:
  - `createPipeReader`, `getPipePath` from `./pipe.js`
  - `reducer`, `initialState` from `./reducer.js`
  - All UI components from previous task
  - `ForgeEvent` from `./types.js`
- Produces: default export `App` React component — rendered by `runWatch()` in Task 6.

- [ ] **Step 1: Create `bin/ui/App.tsx`**

```tsx
import { Box, useApp, useInput } from 'ink';
import React, { useEffect, useReducer, useState } from 'react';
import { ActivityLog } from './ActivityLog.js';
import { AgentPanel } from './AgentPanel.js';
import { CheckBar } from './CheckBar.js';
import { Header } from './Header.js';
import { KeyBindings } from './KeyBindings.js';
import { TaskBar } from './TaskBar.js';
import { createPipeReader, getPipePath } from './pipe.js';
import { initialState, reducer } from './reducer.js';
import type { ForgeEvent } from './types.js';

export default function App() {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    const pipePath = getPipePath();
    const cleanup = createPipeReader(pipePath, (line) => {
      let event: ForgeEvent;
      try {
        event = JSON.parse(line) as ForgeEvent;
      } catch {
        event = { type: '_unknown', ts: Date.now() / 1000, raw: line };
      }
      dispatch(event);
    });
    return cleanup;
  }, []);

  useInput((_input, key) => {
    const input = _input.toLowerCase();
    if (input === 'q') {
      exit();
      return;
    }
    if (input === 'c') {
      dispatch({ type: '_clear_log', ts: Date.now() / 1000 });
      return;
    }
    if (key.upArrow) setScrollOffset((o) => Math.min(o + 1, 0));
    if (key.downArrow) setScrollOffset((o) => Math.max(o - 1, -(state.logs.length)));
  });

  return (
    <Box flexDirection="column">
      <Header connected={state.connected} />
      <TaskBar task={state.task} />
      <Box flexDirection="row">
        <AgentPanel agents={state.agents} />
        <ActivityLog logs={state.logs} scrollOffset={scrollOffset} />
      </Box>
      <CheckBar checks={state.checks} />
      <KeyBindings />
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add bin/ui/App.tsx
git commit -m "feat(ui): App root component wires pipe reader, reducer, keyboard input"
```

---

### Task 6: CLI Wiring — `--watch`, `--emit`, and integration smoke test

**Files:**
- Modify: `bin/lib/context.ts` (add `watch`, `emit`, `emitPayload`)
- Create: `bin/lib/watch.tsx`
- Create: `bin/lib/emit.ts`
- Modify: `bin/forgeai-init.ts` (add routing for `--watch` and `--emit`)

**Interfaces:**
- Consumes: `App` from `../ui/App.js`, `emitToPipe`, `getPipePath` from `../ui/pipe.js`
- Produces: `forgeai-init --watch` starts TUI; `forgeai-init --emit '<json>'` writes one event.

- [ ] **Step 1: Add flags to `bin/lib/context.ts`**

Add these three lines after the existing `export const skipUpdateCheck` line:

```ts
export const watch = args.has('--watch');
export const emit = args.has('--emit');
export const emitPayload = getArgValue('--emit');
```

- [ ] **Step 2: Create `bin/lib/watch.tsx`**

```tsx
import { render } from 'ink';
import React from 'react';
import App from '../ui/App.js';

export function runWatch(): void {
  render(<App />);
}
```

- [ ] **Step 3: Create `bin/lib/emit.ts`**

```ts
import { emitPayload } from './context.js';
import { emitToPipe, getPipePath } from '../ui/pipe.js';

export function runEmit(): void {
  if (!emitPayload) {
    console.error("Usage: forgeai-init --emit '{\"type\":\"...\",\"ts\":1234}'");
    process.exit(1);
  }
  try {
    JSON.parse(emitPayload);
  } catch {
    console.error('Error: --emit value must be valid JSON');
    process.exit(1);
  }
  try {
    emitToPipe(getPipePath(), emitPayload);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Add routing to `bin/forgeai-init.ts`**

Add these two imports at the top of `bin/forgeai-init.ts` with the other imports:

```ts
import { watch, emit } from './lib/context.js';
import { runWatch } from './lib/watch.js';
import { runEmit } from './lib/emit.js';
```

Add these two routing lines before the final `else runInit()` line:

```ts
else if (watch) runWatch();
else if (emit) runEmit();
```

The relevant block should look like:

```ts
// ... existing routes ...
else if (checkApproval) runCheckApproval();
else if (checkEvaluation) runCheckEvaluation();
else if (watch) runWatch();
else if (emit) runEmit();
else runInit();
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0, `dist/` now includes the compiled UI files.

- [ ] **Step 6: Full test suite**

```bash
npm test
```

Expected: all tests pass including the new `pipe.test.ts` and `ui-reducer.test.ts`.

- [ ] **Step 7: Manual smoke test — open two terminals**

**Terminal A (TUI):**
```bash
node --import tsx bin/forgeai-init.ts --watch
```
Expected: dashboard appears with `○ WAITING` in header.

**Terminal B (emit events one by one):**
```bash
node --import tsx bin/forgeai-init.ts --emit '{"type":"orchestrator.start","task":"Build auth module","ts":1720000000}'
node --import tsx bin/forgeai-init.ts --emit '{"type":"agent.assigned","agentId":"codex-1","role":"implementer","task":"Write auth.ts","ts":1720000003}'
node --import tsx bin/forgeai-init.ts --emit '{"type":"agent.progress","agentId":"codex-1","message":"Writing src/auth.ts...","ts":1720000010}'
node --import tsx bin/forgeai-init.ts --emit '{"type":"check.run","name":"security","status":"running","ts":1720000020}'
node --import tsx bin/forgeai-init.ts --emit '{"type":"check.result","name":"security","status":"pass","ts":1720000025}'
node --import tsx bin/forgeai-init.ts --emit '{"type":"agent.done","agentId":"codex-1","status":"success","ts":1720000060}'
```

Expected: Terminal A updates in real-time — header switches to `● LIVE`, agent card for `codex-1` appears and updates, check bar shows `✓ security`, log panel streams each event.

Press `Q` in Terminal A: TUI exits cleanly, `.forgeai.pipe` is removed.

- [ ] **Step 8: Commit**

```bash
git add bin/lib/context.ts bin/lib/watch.tsx bin/lib/emit.ts bin/forgeai-init.ts
git commit -m "feat(ui): wire --watch and --emit CLI flags; Phase 9 complete"
```

---

## Acceptance Criteria Checklist

- [ ] `forgeai-init --watch` starts and shows `○ WAITING`
- [ ] `orchestrator.start` event → header shows `● LIVE`, task bar shows task name
- [ ] `agent.assigned` → new agent card appears
- [ ] `agent.progress` → card message updates in place
- [ ] `agent.done` → icon changes to `✓`/`✗`, elapsed time shown
- [ ] `check.run` / `check.result` → check bar updates inline
- [ ] Activity log scrolls with `↑↓`
- [ ] `C` clears the log
- [ ] `Q` exits cleanly, removes `.forgeai.pipe`
- [ ] Malformed JSON does not crash
- [ ] `npm test` passes (typecheck + build + all unit tests)
