---
name: spec-planning
description: Use this skill when turning a rough idea, Jira ticket, product requirement, or design into a proposal, design doc, task list, and OpenSpec-style change folder.
---

# Spec Planning Skill

## Purpose

Convert vague requirements into buildable specs so coding agents can execute reliably.

## When to Use

Use for:

- New feature.
- Medium/large refactor.
- Multi-file or FE+BE task.
- Requirement from Jira/Notion/Trello.
- Work that needs human approval before implementation.

Skip full spec for tiny one-line fixes. Use mini spec instead.

## Required Outputs

For each change create:

```text
openspec/changes/<change-id>/proposal.md
openspec/changes/<change-id>/design.md
openspec/changes/<change-id>/tasks.md
openspec/changes/<change-id>/specs/<capability>.md
```

## Change ID Rule

Use kebab-case, verb-first:

- `add-marketplace-like-optimistic-ui`
- `fix-reset-password-token-expired-redirect`
- `integrate-jira-task-intake`

## Planning Workflow

### 1. Problem framing

Answer:

- Who needs this?
- What problem does it solve?
- What is the expected behavior?
- What happens if we do nothing?

### 2. Scope boundary

Define:

- In scope.
- Out of scope.
- Assumptions.
- Risks.

### 3. Acceptance criteria

Write testable criteria:

```md
- Given ..., when ..., then ...
```

### 4. Implementation tasks

Break into tasks small enough for sub-agents:

- FE task.
- BE task.
- DB task.
- Integration task.
- Test/review task.

### 5. Validation plan

Define how human/agent knows it works.

## Mini Spec Template

```md
## Intent

## Scope

## Acceptance Criteria

## Implementation Plan

## Validation

## Risks
```
