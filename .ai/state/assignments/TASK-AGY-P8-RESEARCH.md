## Assignment
- ID: TASK-AGY-P8-RESEARCH
- Role: research
- Objective: Scan the repository and produce a structured inventory of all
  existing worktree references, session-handling patterns, and fallback code
  paths. This inventory informs the Phase 8 architecture decisions.
- Model tier: fast
- Token budget: 4000
- Session ID: agt-p8-research

## Allowed context
- This assignment file only.
- Read-only access to the following paths:
  - `.ai/state/sessions.md`
  - `.ai/workflows/`
  - `.ai/router/run-model.ts`
  - `.ai/model-routing.yaml`
  - `.ai/WORKFLOW.md`
  - `bin/lib/` (all `.ts` files)

## Coordination scope
- Read scope: `.ai/state/sessions.md`, `.ai/workflows/`, `.ai/router/`, `.ai/model-routing.yaml`, `.ai/WORKFLOW.md`, `bin/lib/`
- Write scope: `.ai/state/tasks/p8-research-inventory.md` (new file)
- Parallel safety: independent

## Constraints
- Do not edit any existing files.
- Do not write implementation code.
- Do not install packages or run shell commands beyond `grep` / `find` for
  searching text in the allowed paths.
- Keep the output under 3000 tokens.

## Acceptance criteria
- [ ] Lists every file that references `worktree` with line numbers.
- [ ] Lists every file that references `sessions` or `session_id` with line numbers.
- [ ] Lists every fallback code path in `router/run-model.ts` (function names,
  line ranges, and the trigger condition).
- [ ] Notes any gaps or ambiguities relevant to Phase 8 design.

## Validation
- Read `.ai/state/tasks/p8-research-inventory.md` and confirm it contains
  all three inventory sections (worktree refs, session refs, fallback paths).

## Return format
Write `.ai/state/tasks/p8-research-inventory.md` using this structure:

```markdown
# P8 Research Inventory

## Worktree References
| File | Line | Snippet |
| --- | --- | --- |
| ... | ... | ... |

## Session References
| File | Line | Snippet |
| --- | --- | --- |
| ... | ... | ... |

## Fallback Code Paths (router/run-model.ts)
| Function | Lines | Trigger condition |
| --- | --- | --- |
| ... | ... | ... |

## Gaps and Notes
- ...
```

Also return:
- Summary: one paragraph of key findings.
- Risks or open questions for Phase 8 design.
