# Review Scorecard Template

Copy this file to `.ai/state/reviews/<task-id>.md` when a task enters the
`review` state. The review gate (`forgeai-init --check-review`) requires a
completed scorecard, plus real validation evidence in the task journal, before
a gated task can move to `acceptance` or `closed`.

- Task ID: `TASK-YYYYMMDD-short-slug`
- Reviewer: `TODO`
- Date: `YYYY-MM-DD`

## Scorecard

| Dimension | Rating | Notes |
| --- | --- | --- |
| Correctness | `pass \| concern \| fail` | TODO |
| Scope control | `pass \| concern \| fail` | TODO |
| Security | `pass \| concern \| fail` | TODO |
| Tests/validation | `pass \| concern \| fail` | TODO |
| Maintainability | `pass \| concern \| fail` | TODO |
| Release risk | `pass \| concern \| fail` | TODO |

Unresolved blockers: TODO (list blocker findings, or `none`)

Verdict: TODO (Approve | Request changes | Needs human decision)
