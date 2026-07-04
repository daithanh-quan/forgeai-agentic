# Memory Management Workflow

`.ai/MEMORY.md` is read by every agent session. This workflow keeps it
trustworthy.

## When to add an entry

- A decision is made that should hold for weeks or months (architecture,
  conventions, business rules, ownership, deployment).
- A bug or pitfall recurs and future agents must avoid it.
- A command or validation step is discovered that agents would otherwise
  guess wrong.

Do not add temporary task state (use `.ai/state/CURRENT.md`) or anything
already enforced by code, lint, or CI.

## When to prune

- The entry was superseded by a newer decision — delete or rewrite it and
  link the replacement.
- The code it describes was refactored away — delete it.
- It turned out to be wrong — delete it; a wrong memory is worse than no
  memory.

## Responding to `--check-memory` findings

| Finding | Action |
| --- | --- |
| `references missing path` (fail) | The path moved or was deleted. Fix the reference or prune the entry. Do not silence it by rewording. |
| `unfilled TODO placeholder` (warn) | Fill in real project knowledge or delete the placeholder row/section. |
| `entry dated ... older than N days` (warn) | Re-validate: still true → update the date; changed → rewrite; superseded → prune. |
| `decision heading does not match` / `missing **Decision/Why/Impact**` (warn) | Reformat the entry to `### YYYY-MM-DD — Title` with Decision/Why/Impact bullets. |

## Rule for agents

If you notice memory that contradicts the code you are reading, do not
silently obey the memory and do not silently delete it. Flag the conflict to
the human with the evidence, then update the entry once the human confirms.

Tune the re-validation window by editing the directive at the top of
`.ai/MEMORY.md`, for example `<!-- forgeai-memory: max-age-days=365 -->`.
