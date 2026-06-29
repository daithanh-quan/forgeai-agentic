---
name: code-review
description: Use this skill when reviewing code changes before human approval, checking diffs, identifying bugs, validating scope, or preparing PR review notes.
---

# Code Review Skill

## Purpose

Review changes like a senior engineer focused on correctness, safety, maintainability, and scope control.

## Review Order

1. Requirement coverage.
2. Scope creep.
3. Runtime bugs.
4. Type safety.
5. Error handling.
6. Security/auth.
7. Performance.
8. Tests/validation.
9. Maintainability.

## Questions to Ask

- Does the change solve the actual task?
- Did it modify unrelated behavior?
- Are edge cases handled?
- Are loading/error/empty states covered?
- Can mutation failure leave UI in wrong state?
- Can backend partial failure corrupt data?
- Is any secret or sensitive data exposed?
- Are tests adequate for the risk level?

## Severity Labels

- `blocker`: Must fix before merge.
- `major`: Should fix before merge.
- `minor`: Nice improvement.
- `nit`: Style/readability only.

## Output Format

```md
## Review Summary

## Findings

### blocker
- ...

### major
- ...

### minor
- ...

## Validation Gaps

## Recommendation
Approve | Request changes | Needs human decision
```
