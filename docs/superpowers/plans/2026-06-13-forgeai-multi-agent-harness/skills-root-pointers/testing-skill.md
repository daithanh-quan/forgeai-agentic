# Testing Skill

## Purpose

Ensure changes have adequate test coverage and validation evidence before
review.

## Read First

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/agents/tester.md`

## Workflow

### 1. Identify what changed

- New/changed functions, endpoints, components, or behaviors.
- Edge cases implied by the acceptance criteria.

### 2. Match existing test conventions

- Find existing tests near the changed code.
- Reuse fixtures/mocks/helpers already in the project.

### 3. Write tests

- Cover the happy path and the edge cases from the acceptance criteria.
- For UI: cover loading, error, and empty states where applicable.
- For APIs: cover success and key error responses.

### 4. Run validation

Run, in order:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If the project uses pnpm/yarn/bun, use the matching commands. If a command
does not exist, note that and choose the closest equivalent from
`package.json`.

### 5. Document results

- Command run → result.
- Command not run → reason.
- Manual QA steps for anything not covered by automated tests.

## Output Checklist

- [ ] New/changed behavior has test coverage or a documented reason it
      cannot be tested.
- [ ] Existing tests still pass.
- [ ] Validation commands run in order, results recorded.
- [ ] Manual QA steps documented where needed.
```

- [x] **Step 2: Verify**

```bash
test -f templates/.ai/skills/testing/SKILL.md && head -4 templates/.ai/skills/testing/SKILL.md
```

Expected: shows the YAML frontmatter starting with `---` and `name: testing`.

- [x] **Step 3: Commit**

```bash
git add templates/.ai/skills/testing/SKILL.md
git commit -m "add model-agnostic testing skill"
```

---

### Task 9: Add Claude-native skills under `.claude/skills/`

**Files:**
- Create: `templates/.claude/skills/frontend/SKILL.md`
- Create: `templates/.claude/skills/backend/SKILL.md`
- Create: `templates/.claude/skills/testing/SKILL.md`
- Create: `templates/.claude/skills/reviewer/SKILL.md`

These are thin, Claude Code-discoverable wrappers (valid `SKILL.md` with
`name`/`description` frontmatter) that point back to the canonical
model-agnostic skill docs in `.ai/skills/`, keeping content DRY.

- [x] **Step 1: Create `templates/.claude/skills/frontend/SKILL.md`**

```markdown
---
name: frontend
description: Use this skill when implementing or modifying frontend features, React/Next.js components, forms, optimistic UI, or client-side data fetching.
---

