# Frontend (ForgeAI)

This is the Claude Code entry point for ForgeAI's frontend implementation
guidance. The full workflow, rules, and output checklist live in the
model-agnostic skill file — read it before implementing:

- `.ai/skills/frontend-implementation/SKILL.md`

Also read, in order:

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md`
- `.ai/agents/frontend.md` — agent role definition and completion checklist
```

- [x] **Step 2: Create `templates/.claude/skills/backend/SKILL.md`**

```markdown
---
name: backend
description: Use this skill when implementing backend APIs, services, database queries, auth, transactions, integrations, webhooks, or server-side business logic.
---

# Backend (ForgeAI)

This is the Claude Code entry point for ForgeAI's backend implementation
guidance. The full workflow, rules, and output checklist live in the
model-agnostic skill file — read it before implementing:

- `.ai/skills/backend-implementation/SKILL.md`

Also read, in order:

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- `.ai/agents/backend.md` — agent role definition and completion checklist
```

- [x] **Step 3: Create `templates/.claude/skills/testing/SKILL.md`**

```markdown
---
name: testing
description: Use this skill when adding or updating automated tests, running validation commands, or documenting manual QA steps for a change.
---

# Testing (ForgeAI)

This is the Claude Code entry point for ForgeAI's testing guidance. The full
workflow and output checklist live in the model-agnostic skill file — read
it before writing tests:

- `.ai/skills/testing/SKILL.md`

Also read:

- `.ai/PROJECT.md` (test framework, validation commands)
- `.ai/RULES.md` (validation order)
- `.ai/agents/tester.md` — agent role definition and completion checklist
```

- [x] **Step 4: Create `templates/.claude/skills/reviewer/SKILL.md`**

```markdown
---
name: reviewer
description: Use this skill when reviewing code changes before human approval, checking diffs, identifying bugs, validating scope, or preparing review notes.
---

# Reviewer (ForgeAI)

This is the Claude Code entry point for ForgeAI's review guidance. The full
review order, questions, severity labels, and output format live in the
model-agnostic skill file — read it before reviewing:

- `.ai/skills/code-review/SKILL.md`

Also read:

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md` (known pitfalls)
- `.ai/agents/reviewer.md` — agent role definition and completion checklist
```

- [x] **Step 5: Verify**

```bash
for f in frontend backend testing reviewer; do
  test -f templates/.claude/skills/$f/SKILL.md && echo "$f OK"
done
```

Expected: all four print `OK`.

- [x] **Step 6: Commit**

```bash
git add templates/.claude/skills
git commit -m "add Claude Code native skill wrappers under .claude/skills"
```

---

### Task 10: Update `.ai/README.md`

**Files:**
- Modify: `templates/.ai/README.md`

- [x] **Step 1: Update the recommended read order and add naming/skills notes**

Replace the full content of `templates/.ai/README.md`:

Old (current full file):
```markdown
