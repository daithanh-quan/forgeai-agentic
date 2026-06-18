# Agentic Workflow

This file defines the default flow from task intake to human review.

## Overview

```text
Task intake
  -> Clarify scope
  -> Decide if spec is needed
  -> Plan subtasks
  -> Score and route subtasks
  -> Route to agent/skill
  -> Implement
  -> Validate
  -> Review
  -> Human approval
```

## 1. Task intake

The agent collects:

- Source: Jira, GitHub issue, Bitbucket PR, Notion, Trello, manual request, or design link.
- Requirement.
- Acceptance criteria.
- Screenshots/design links if any.
- Related files if known.
- Deadline/priority if any.

Use `.ai/workflows/task-intake.md` as the template.

## 2. Clarify scope

If information is missing, the agent should not stop immediately. The agent writes:

```markdown
## Assumptions
- Assumption 1

## Safe minimal scope
- Smallest implementation that satisfies the task

## Out of scope
- What will not be changed
```

Only ask the human when missing information could cause data loss, change a major business rule, or affect security/payment/auth.

## 3. Decide if OpenSpec is needed

Small tasks can use a mini spec in the response.

Medium or large tasks should create an OpenSpec-style change:

```text
openspec/changes/<change-id>/
  proposal.md
  design.md
  tasks.md
  specs/<capability>.md
```

Use OpenSpec when the task changes behavior, adds a feature, changes an API contract, or creates a new workflow.

## 4. Plan subtasks

The plan should be short and executable:

```markdown
- [ ] Inspect current implementation
- [ ] Update types/contracts
- [ ] Implement UI/API changes
- [ ] Add or update tests
- [ ] Run validation
- [ ] Prepare review summary
```

## 5. Score and route subtasks

Follow `.ai/MODEL_ROUTING.md` and `.ai/model-routing.yaml`.

- Score complexity, risk, ambiguity, and context for each subtask.
- Apply minimum-tier overrides for architecture and sensitive work.
- Give delegated models bounded assignments and only required context.
- Route scores `0-2` to Gemini, scores `3-5` to Codex, and scores `6-10` to
  Claude unless `.ai/model-routing.yaml` has been intentionally changed.
- Send delegated output to the Claude reviewer sub-agent before final
  delivery.

If the environment cannot invoke the selected model, use the configured
fallback instead of blocking the task. The default fallback is for the current
model to execute the bounded assignment locally.

## 6. Implementation

Agents should work in small steps. Each step should have a checkpoint:

- What changed?
- Why was it needed?
- What should be tested?

## 7. Validation

Prefer commands already defined in `package.json`.

If validation cannot run, document:

- Command attempted.
- Main error.
- Why the agent did not continue fixing it in this task scope.

## 8. Review

The review agent checks:

- Scope control.
- Type safety.
- Error handling.
- Test coverage or manual validation.
- Security concerns.
- Migration/API risks.

If the Claude reviewer returns `Request changes`, send the concrete findings
back to the implementing model once. If the second attempt still fails, the
current model fixes the issue locally or escalates the remaining decision to
the human.

## 9. Human approval

The final result should be easy for a human to review:

```markdown
## Summary
## Key files
## Validation
## Risks / follow-up
```
