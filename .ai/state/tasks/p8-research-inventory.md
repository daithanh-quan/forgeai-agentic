# P8 Research Inventory

## Worktree References
| File | Line | Snippet |
| --- | --- | --- |
| [bin/lib/git.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/git.ts#L116) | 116 | `console.log('Result: git unavailable. Install git before using worktree or branch checks.');` |
| [bin/lib/git.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/git.ts#L123) | 123 | `console.log(formatStatus('missing', 'not inside a git worktree'));` |
| [bin/lib/git.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/git.ts#L125) | 125 | `console.log('Result: git repository not found. Run git init or connect a repository before branch/worktree checks.');` |
| [bin/lib/git.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/git.ts#L151) | 151 | `console.log('Branch and worktree');` |
| [bin/lib/init.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/init.ts#L37) | 37 | `--check-git   Validate git branch, worktree, remote, hooks, and PR/MR tooling.` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L133) | 133 | `## 5a. Branch and worktree naming` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L135) | 135 | `When the workflow requires a branch or worktree, use a semantic branch name` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L153) | 153 | `git worktree add ../.worktrees/forgeai-check -b feat/forgeai-check origin/main` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L154) | 154 | `git worktree add ../.worktrees/router-fallback -b fix/router-fallback origin/main` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L164) | 164 | `If using worktrees without a remote base, create the worktree from the current` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L168) | 168 | `git worktree add ../.worktrees/forgeai-check -b feat/forgeai-check main` |

## Session References
| File | Line | Snippet |
| --- | --- | --- |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L6) | 6 | `import { parseSessionTable, isUnfinishedSession } from './sessions.js';` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L77) | 77 | `console.log('Session coordination');` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L78) | 78 | `const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L79) | 79 | `if (!fs.existsSync(sessionsPath)) {` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L83) | 83 | `const unfinishedSessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8')).filter(isUnfinishedSession);` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L84) | 84 | `console.log(formatStatus('ok', \`.ai/state/sessions.md (\${unfinishedSessions.length} active)\`));` |
| [bin/lib/check.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/check.ts#L85) | 85 | `console.log(formatStatus('check', 'run forgeai-init --check-sessions before parallel agent work'));` |
| [bin/lib/context.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/context.ts#L23) | 23 | `export const checkSessions = args.has('--check-sessions');` |
| [bin/lib/init.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/init.ts#L14) | 14 | `forgeai-init --check-sessions` |
| [bin/lib/init.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/init.ts#L38) | 38 | `--check-sessions` |
| [bin/lib/init.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/init.ts#L39) | 39 | `Validate active agent sessions for overlapping write scopes.` |
| [bin/lib/init.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/init.ts#L110) | 110 | `'.ai/state/sessions.md'` |
| [bin/lib/lifecycle.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/lifecycle.ts#L6) | 6 | `import { cleanTableCell } from './sessions.js';` |
| [bin/lib/review.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/review.ts#L5) | 5 | `import { splitTableRow, cleanTableCell } from './sessions.js';` |
| [bin/lib/types.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/types.ts#L26) | 26 | `export type AgentSession = {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L3) | 3 | `import type { AgentSession } from './types.js';` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L62) | 62 | `export function parseSessionTable(content: string): AgentSession[] {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L63) | 63 | `const sessions: AgentSession[] = [];` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L64) | 64 | `let inActiveSessions = false;` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L69) | 69 | `inActiveSessions = /^##\\s+Active Sessions\\b/i.test(line);` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L73) | 73 | `if (!inActiveSessions || !line.startsWith('|')) continue;` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L81) | 81 | `if (!id || id === 'example-session') continue;` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L83) | 83 | `sessions.push({` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L96) | 96 | `return sessions;` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L99) | 99 | `export function isUnfinishedSession(session: AgentSession): boolean {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L100) | 100 | `return !['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled'].includes(session.status);` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L103) | 103 | `export function runCheckSessions(): void {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L104) | 104 | `console.log('ForgeAI session check');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L107) | 107 | `const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L108) | 108 | `if (!fs.existsSync(sessionsPath)) {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L109) | 109 | `console.log(formatStatus('missing', '.ai/state/sessions.md'));` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L111) | 111 | `console.log('Result: session coordination file missing. Run forgeai-init --upgrade to install it.');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L116) | 116 | `const sessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8'));` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L117) | 117 | `const unfinished = sessions.filter(isUnfinishedSession);` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L119) | 119 | `if (sessions.length === 0) {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L120) | 120 | `console.log(formatStatus('ok', 'no real sessions recorded'));` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L122) | 122 | `console.log('Result: no active session overlap detected.');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L126) | 126 | `for (const session of sessions) {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L127) | 127 | `const writeScope = session.writeScope.length > 0 ? session.writeScope.join(', ') : 'missing';` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L128) | 128 | `const status = isUnfinishedSession(session) ? 'active' : 'closed';` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L129) | 129 | `console.log(formatStatus(status, \`\-- \${session.id} \${session.status || 'unknown'} write: \${writeScope}\`));` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L135) | 135 | `for (const session of unfinished) {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L136) | 136 | `if (session.writeScope.length === 0) {` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L138) | 138 | `console.log(formatStatus('invalid', \`\${session.id} has no write scope\`));` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L163) | 163 | `console.log('Result: active sessions need coordination before parallel agent work continues.');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L169) | 169 | `console.log('Result: no active sessions.');` |
| [bin/lib/sessions.ts](file:///Users/admin/Documents/Learn/forgeai-agentic/bin/lib/sessions.ts#L173) | 173 | `console.log('Result: active sessions have disjoint write scopes.');` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L1) | 1 | `# Agent Sessions` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L3) | 3 | `Track active agent sessions here before running parallel work. This file is` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L6) | 6 | `## Active Sessions` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L10) | 10 | `| example-session | Codex | Example only | feat/example | done | YYYY-MM-DD | README.md | README.md | Remove this row when real work starts |` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L14) | 14 | `- Add or update a row before starting a session that may read or edit project` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L16) | 16 | `- Use active, paused, or blocked for unfinished sessions; use done` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L17) | 17 | `when the session is complete.` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L21) | 21 | `- If a session needs broad repository context, mark the read scope as repo` |
| [.ai/state/sessions.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/state/sessions.md#L23) | 23 | `- The orchestrator runs forgeai-init --check-sessions before launching` |
| [.ai/workflows/lifecycle-management.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/lifecycle-management.md#L65) | 65 | `4. The orchestrator runs forgeai-init --check-sessions when more than one` |
| [.ai/workflows/lifecycle-management.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/lifecycle-management.md#L66) | 66 | `session may be active.` |
| [.ai/workflows/lifecycle-management.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/lifecycle-management.md#L79) | 79 | `- Temporary session rows in .ai/state/sessions.md are marked done or removed.` |
| [.ai/workflows/memory-management.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/memory-management.md#L3) | 3 | `.ai/MEMORY.md is read by every agent session. This workflow keeps it` |
| [.ai/workflows/codegraph-context.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/codegraph-context.md#L57) | 57 | `the task journal write scope aligned with the context pack and session table.` |
| [.ai/workflows/delegated-assignment.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/delegated-assignment.md#L13) | 13 | `- Session ID: agent-task-...` |
| [.ai/workflows/task-intake.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/task-intake.md#L56) | 56 | `## Session Coordination` |
| [.ai/workflows/task-intake.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/workflows/task-intake.md#L58) | 58 | `| Session ID | Subtask | Read scope | Write scope | Parallel safety |` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L115) | 115 | `- For parallel work, the orchestrator records each active session in` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L116) | 116 | `.ai/state/sessions.md with read/write scope and runs` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L117) | 117 | `forgeai-init --check-sessions.` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L129) | 129 | `If session write scopes overlap, do not run those assignments in parallel.` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L130) | 130 | `Narrow the write scopes, sequence the work, or ask the human which session` |
| [.ai/WORKFLOW.md](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/WORKFLOW.md#L298) | 298 | `- Active session rows in .ai/state/sessions.md are marked done or removed.` |
| [.ai/model-routing.yaml](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/model-routing.yaml#L12) | 12 | `- coordinate active session scopes before parallel work` |
| [.ai/model-routing.yaml](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/model-routing.yaml#L124) | 124 | `require_session_scope_for_parallel_work: true` |

## Fallback Code Paths (router/run-model.ts)
| Function | Lines | Trigger condition |
| --- | --- | --- |
| `fallback` | [151-164](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/router/run-model.ts#L151-L164) | Definition of the fallback reporter function. Formats and prints a JSON payload with `status: 'fallback'` to stdout. |
| Main Execution (Missing Adapter) | [193-200](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/router/run-model.ts#L193-L200) | Triggered when `!adapter` evaluates to true (the provider requested does not have a configured adapter in `.ai/cli-adapters.json`). |
| Main Execution (Healthcheck Failure) | [207-215](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/router/run-model.ts#L207-L215) | Triggered when `healthFailure` is truthy (the healthcheck command for the selected adapter fails, times out, or matches defined quota/rate-limit substrings). |
| Main Execution (Run Failure Fallback) | [236-245](file:///Users/admin/Documents/Learn/forgeai-agentic/.ai/router/run-model.ts#L236-L245) | Triggered when a model execution fails (`runFailure` is truthy) and the specific failure reason (e.g. `quota_or_rate_limit`) is configured within the list of trigger conditions (`fallbackConfig.on?.includes(runFailure)`). |

## Gaps and Notes
- **No Automated Worktree Management**: The codebase references git worktree naming conventions and structure (e.g., `.worktrees/`) in `.ai/WORKFLOW.md`, but there is no CLI automation in `bin/lib/git.ts` or elsewhere to set up, switch, or clean up worktrees automatically. Worktree lifecycle management is currently manual.
- **Manual Session Registration**: The active sessions logic in `bin/lib/sessions.ts` validates sessions by parsing `.ai/state/sessions.md`. However, there is no automated tool to create, update, or prune rows in `.ai/state/sessions.md` when launching or completing tasks. It relies entirely on the orchestrator or developer updating the markdown table manually.
- **Rigid Markdown Parsing**: The `parseSessionTable` parser relies on exact markdown formatting (headers, table cells) and requires exactly 9 columns. If a line is formatted slightly differently or has trailing whitespace issues, it might be skipped, causing missed overlap detections.
- **Silent Exit Behavior in Fallbacks**: The `fallback` function returns exit code `0` after writing a JSON payload. If the caller expects text output (e.g. LLM generated code) or expects exit codes to signal status, this can result in silent failures or parse errors in client agents.
- **Disjoint / Check-only Validation**: `forgeai-init --check-sessions` checks for overlap and sets exit code `1` if an issue is found, but it does not provide resolution options or automated scheduling.
