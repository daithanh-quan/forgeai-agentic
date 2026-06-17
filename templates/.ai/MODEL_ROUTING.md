# Model Routing

This document defines how the lead agent scores and delegates work using
`.ai/model-routing.yaml`. The YAML file is the editable routing policy; this
file defines the operating protocol.

Model routing reduces token usage only when subtasks are small, independent,
and receive limited context. Delegating a vague task with the full repository
usually increases cost.

## Lead model

Claude is the default lead. The lead owns:

- Task intake and decomposition.
- Scoring every proposed subtask.
- Architecture, security, and destructive decisions.
- Reviewing delegated output and validation evidence.
- Final synthesis for the human.

The lead may delegate implementation or analysis, but never delegates
accountability for the final result.

## Score a subtask

Score each dimension using `.ai/model-routing.yaml`:

```text
score = complexity + risk + ambiguity + context
```

The maximum score is 10. Route by the configured score range, then apply
`rules.minimum_tier` overrides. A security task with a low numeric score still
routes to the lead tier.

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

## Allowed context
- Exact files or directories the model may read
- Relevant contract or short excerpt

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

## Delegation loop

1. Claude reads the task and repository context.
2. Claude creates independent, bounded subtasks.
3. Claude scores each subtask and applies minimum-tier rules.
4. Claude invokes the configured model through the available CLI, API, MCP,
   or sub-agent tool.
5. The delegated model returns changes or a structured recommendation.
6. Claude inspects the output and validation evidence.
7. Failed or incomplete work is retried once with corrected context, escalated
   to a stronger tier, or completed by Claude.
8. Claude runs the combined review and prepares the final response.

## CLI adapters

Model tiers live in `.ai/model-routing.yaml`. Local CLI execution details live
in `.ai/cli-adapters.json`.

Use the router when the current environment exposes delegated models through
local CLI tools:

```bash
node .ai/router/run-model.js --tier standard --assignment .ai/state/assignments/TASK-01.md
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
- Returns a structured fallback message when delegation cannot run.

Example fallback response:

```json
{
  "status": "fallback",
  "reason": "quota_or_rate_limit",
  "behavior": "lead_executes_locally",
  "message": "Delegated CLI could not run..."
}
```

When fallback behavior is `lead_executes_locally`, the current lead model
should complete the bounded assignment itself using the same acceptance
criteria. A shell script cannot directly force the current chat model to run;
it can only report that delegation failed and hand control back to the lead.

## Tool limitation

This harness defines routing policy; it does not install or authenticate model
providers. Claude can invoke another model only when the current environment
exposes that model through a sub-agent, CLI, API, or MCP tool. Otherwise,
Claude should keep the same task boundaries and execute the assignment locally.

Never place API keys or access tokens in `model-routing.yaml` or any committed
file.
