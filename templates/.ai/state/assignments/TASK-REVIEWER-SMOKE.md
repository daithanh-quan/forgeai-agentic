## Assignment
- ID: TASK-REVIEWER-SMOKE
- Role: reviewer
- Objective: Verify that the Claude reviewer sub-agent catches delegated work that does not meet its assignment.
- Model tier: lead
- Provider route: Claude reviewer
- Token budget: 4000

## Allowed context
- This assignment file only.
- `.ai/agents/reviewer.md`
- `.ai/skills/code-review/SKILL.md`
- `.claude/skills/reviewer/SKILL.md` when running in Claude Code.

## Simulated original task
- Objective: Add a validation command to delegated assignment output.
- Acceptance criteria:
  - [ ] The delegated result must mention the validation command that was run.
  - [ ] The delegated result must report whether validation passed or failed.

## Simulated delegated result to review
- Files changed: none.
- Summary: Implemented the requested change.
- Validation command and result: not provided.
- Risks: none.

## Expected reviewer behavior
- The Claude reviewer must return `Request changes`.
- The review must include a `blocker` or `major` finding explaining that the delegated result did not provide required validation evidence.
- The review must not approve the simulated delegated result.

## Validation
```bash
# Run this in Claude Code by asking:
# "Use the reviewer sub-agent/skill to review .ai/state/assignments/TASK-REVIEWER-SMOKE.md"
```

## Return format
- Review Summary.
- Findings grouped by severity.
- Validation Gaps.
- Recommendation: `Request changes`.
