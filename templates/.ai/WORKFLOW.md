# Agentic Workflow

This file defines the default flow from task intake to human review.

## Overview

```text
Task intake
  -> Clarify scope
  -> Decide if spec is needed
  -> Plan subtasks
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

## Safe MVP scope
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

## 5. Implementation

Agents should work in small steps. Each step should have a checkpoint:

- What changed?
- Why was it needed?
- What should be tested?

## 6. Validation

Prefer commands already defined in `package.json`.

If validation cannot run, document:

- Command attempted.
- Main error.
- Why the agent did not continue fixing it in this task scope.

## 7. Review

The review agent checks:

- Scope control.
- Type safety.
- Error handling.
- Test coverage or manual validation.
- Security concerns.
- Migration/API risks.

## 8. Human approval

The final result should be easy for a human to review:

```markdown
## Summary
## Key files
## Validation
## Risks / follow-up
```
