# Model Routing

This document defines how the lead agent scores and delegates work using
`.ai/model-routing.yaml`. The YAML file is the editable routing policy; this
file defines the operating protocol.

Model routing reduces per-call context only when subtasks are small,
independent, and receive bounded input. Delegating a vague task with the full
repository usually increases total context across all calls.

RTK filters noisy shell command output before it reaches the model context.
RTK is optional and sits below model routing: it controls command output scope,
while this document decides which model should perform the work.

## Orchestrator model

The current model is the default orchestrator unless the human explicitly
chooses another one. "Current model" means the model operating in the user's
active tool or chat session: Claude Code, Codex, AGY, Cline, RooCode, Aider, a
local model, or a custom agent.

The orchestrator owns:

- Task intake and decomposition.
- Scoring every proposed subtask.
- Architecture, security, and destructive decisions.
- Multi-session coordination through `.ai/state/sessions.md`.
- Requesting configured reviewer checks for delegated output and validation
  evidence.
- Final synthesis for the human.

The orchestrator may delegate implementation or analysis, but never delegates
accountability for the final result. If a specific provider CLI is unavailable,
the current model keeps the same task boundaries and executes locally instead
of blocking the workflow.

## Score a subtask

Score each dimension using `.ai/model-routing.yaml`:

```text
score = complexity + risk + ambiguity + context
```

The maximum score is 10. Route by the configured score range, then apply
`rules.minimum_tier` overrides. By default, scores `0-2` route to the fast
tier, scores `3-5` route to the standard tier, scores `6-8` route to the
strong tier, and scores `9-10` stay with the current orchestrator. A security
task with a low numeric score still routes to the configured minimum tier.

Record the decision:

```markdown
| Subtask | C | R | A | X | Total | Tier | Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Add parser unit tests | 1 | 0 | 0 | 0 | 1 | fast | Isolated test work |
```

Use `X` for context size so it is not confused with complexity.

## Create bounded assignments

Every delegated assignment must contain:

```markdown
## Assignment
- ID: TASK-01
- Role: backend
- Objective: One measurable outcome
- Model tier: standard
- Token budget: 8000
- Session ID: agent-task-01

## Allowed context
- Exact files or directories the model may read
- Relevant contract or short excerpt

## Coordination scope
- Read scope: Exact files/directories or `repo`
- Write scope: Exact files/directories the model may edit
- Parallel safety: independent, sequential, or needs-human-decision

## Constraints
- Patterns to preserve
- Files or behavior that must not change

## Acceptance criteria
- [ ] Observable result
- [ ] Required edge case

## Validation
- Command to run

## Return format
- Files changed
- Summary
- Validation result
- Risks or unresolved questions
```

Start from `.ai/workflows/delegated-assignment.md`.

Do not send the entire conversation or all harness files. Send the assignment,
the relevant role/skill, and only the context needed to complete it.

## Prevent session overlap

Before launching parallel delegated work, the orchestrator records each
unfinished session in `.ai/state/sessions.md` with a narrow write scope and
runs:

```bash
forgeai-init --check-sessions
```

Parallel work is allowed only when unfinished sessions have disjoint write
scopes. If scopes overlap, the orchestrator runs those assignments
sequentially, narrows the write scopes, or asks the human to choose which
session owns the shared files.

## Delegation loop

1. The current orchestrator reads the task and repository context.
2. The orchestrator creates independent, bounded subtasks.
3. The orchestrator scores each subtask and applies minimum-tier rules.
4. The orchestrator records active parallel sessions in `.ai/state/sessions.md`
   and checks for write-scope overlap.
5. The orchestrator invokes the configured model through the available CLI,
   API, MCP, or sub-agent tool when delegation is useful and supported.
6. If the selected provider CLI is missing or fails healthcheck, the current
   model executes the bounded assignment locally instead of blocking on the
   router.
7. The delegated model returns changes or a structured recommendation.
8. The configured reviewer reviews the diff, acceptance criteria, and
   validation evidence. If no separate reviewer is available, the orchestrator
   performs the review locally using `.ai/skills/code-review/SKILL.md`.
9. If the reviewer requests changes, return the findings to the same
   implementing model once with corrected context. If the retry still fails or
   the model is unavailable, the current model completes the fix locally or
   escalates to the human for a decision.
10. The orchestrator marks completed sessions as `done` and prepares the final
   response after review passes or
   remaining risk is explicitly documented.

## CLI adapters

Model tiers live in `.ai/model-routing.yaml`. Local CLI execution details live
in `.ai/cli-adapters.json`.

### Add your own model CLI

Register a model CLI you already have (e.g. a GLM CLI) as a routable adapter
without hand-editing config:

```bash
# Minimal one-liner (command defaults to the provider name).
forgeai-init --add-model glm --model glm-4.6

# Also repoint a routing tier (the only thing that edits model-routing.yaml).
forgeai-init --add-model glm --model glm-4.6 --tier standard

# Override the call shape for a non-standard CLI.
forgeai-init --add-model zai --command zai-cli --input argv \
  --args '["chat","--model","{model}","--message","{assignment}"]'
```

Defaults: `--command` = provider name, `--args` = `["--model","{model}"]`,
`--input` = `stdin`, `--healthcheck-args` = `["--version"]`,
`--healthcheck-timeout` = `5000`. Keep the `{model}` placeholder in `--args`;
the router substitutes the real id at run time. Without `--tier`, only
`.ai/cli-adapters.json` is changed and the provider is usable via
`run-model.ts --provider <name> --model <id>`. Use `forgeai-init --list-models`
and `forgeai-init --remove-model <name>` to inspect or remove adapters. These
two config files are preserved across `forgeai-init --upgrade`, so custom
adapters survive upgrades. Never store API keys here — use environment
variables.

Use the router when the current environment exposes delegated models through
local CLI tools:

```bash
npx tsx .ai/router/run-model.ts --tier standard --assignment .ai/state/assignments/TASK-01.md
```

The router:

- Reads the tier's `provider`, `model`, and `token_budget` from
  `.ai/model-routing.yaml`.
- Finds the provider adapter in `.ai/cli-adapters.json`.
- Runs the adapter healthcheck, usually `--version`, to detect missing CLI
  commands before sending task context.
- Sends the assignment to the CLI through stdin or argv, depending on the
  adapter.
- Detects common quota/rate-limit/billing failures from CLI output.
- Treats non-zero delegated CLI exits as fallback events unless the adapter
  policy has been intentionally changed.
- Returns a structured fallback message when delegation cannot run.

Example fallback response:

```json
{
  "status": "fallback",
  "reason": "quota_or_rate_limit",
  "behavior": "current_model_executes_locally",
  "message": "Delegated CLI could not run..."
}
```

When fallback behavior is `current_model_executes_locally`, the current model
should complete the bounded assignment itself using the same acceptance
criteria. A shell script cannot directly force the current chat model to run;
it can only report that delegation failed and hand control back to the
orchestrator.

## Tool limitation

This harness defines routing policy; it does not install or authenticate model
providers. The orchestrator can invoke AGY, Codex, Claude, a dedicated
reviewer, or any other model only when the current environment exposes that
model through a sub-agent, CLI, API, or MCP tool. Otherwise, the current model
should keep the same task boundaries and execute the assignment locally.

Never place API keys or access tokens in `model-routing.yaml` or any committed
file.

## RTK output filtering

When RTK is installed, agents should prefer filtered command wrappers for
high-output diagnostics:

```bash
rtk git status
rtk git diff
rtk grep "pattern" .
rtk read path/to/file
rtk test npm test
```

If RTK is missing, use the original command. If RTK output is too compact to
review correctness, rerun the original command for the specific file, failure,
or test case. RTK must never replace the configured reviewer gate or
model-routing fallback behavior.

## Reviewer smoke test

To check whether a reviewer is actually reviewing delegated work in your
environment, run the included smoke test. In Claude Code, you can use the
Claude reviewer skill; in other tools, ask the current orchestrator or your
configured reviewer to apply `.ai/skills/code-review/SKILL.md`:

```text
Use the reviewer agent/skill to review .ai/state/assignments/TASK-REVIEWER-SMOKE.md
```

The expected result is `Request changes` with a `blocker` or `major` finding
about missing validation evidence. If the reviewer approves that assignment,
the reviewer is not following `.ai/agents/reviewer.md` and
`.ai/skills/code-review/SKILL.md`.
