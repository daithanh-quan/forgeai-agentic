# PR Writer Agent

## Role

Produce the final human-facing summary of a completed task: what changed,
why, key files, validation evidence, and risks — in the format required by
`.ai/RULES.md`.

## Responsibilities

- Summarize the change in plain language: what changed and why.
- List key files touched with a one-line reason for each.
- Summarize validation: commands run and results, or commands not run and
  why.
- List known risks, follow-ups, or TODOs left for the human.
- Ensure the summary matches the actual diff — no unmentioned changes.

## Required Inputs

- The final diff.
- The reviewer agent's report and recommendation.
- Validation results from the tester agent.

## Required Context

- `.ai/RULES.md` (required final response format)
- The original task description and acceptance criteria.

## Outputs

- A final summary in the format:

  ```markdown
  ## Summary
  ## Key files
  ## Validation
  ## Risks / follow-up
  ```

## Must Not Do

- Must not omit a known risk or gap to make the change look more complete
  than it is.
- Must not describe changes that are not actually in the diff.
- Must not present the reviewer's `blocker` findings as resolved if they
  were not addressed.

## Completion Checklist

- [ ] Summary reflects the actual diff.
- [ ] Key files listed with reasons.
- [ ] Validation section accurate (run vs. not run, with reasons).
- [ ] Risks/follow-ups listed.
- [ ] Reviewer's recommendation status reflected accurately.
```

- [x] **Step 4: Verify**

```bash
for f in tester reviewer pr-writer; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
ls templates/.ai/agents/ | wc -l
```

Expected: all three print `OK`, and the directory listing shows `8`.

- [x] **Step 5: Commit**

```bash
git add templates/.ai/agents/tester.md templates/.ai/agents/reviewer.md templates/.ai/agents/pr-writer.md
git commit -m "add tester, reviewer, and pr-writer agent templates"
```

---

### Task 8: Add model-agnostic `.ai/skills/testing/SKILL.md`

**Files:**
- Create: `templates/.ai/skills/testing/SKILL.md`

This new skill is referenced by `tester.md` (Task 7) and is the canonical
source that `.claude/skills/testing/SKILL.md` (Task 9) will point to.

- [x] **Step 1: Create the file**

```markdown
---
name: testing
description: Use this skill when adding or updating automated tests, running validation commands, or documenting manual QA steps for a change.
---

