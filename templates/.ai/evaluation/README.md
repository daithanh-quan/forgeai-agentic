# Evaluation Runs

This directory stores lightweight run logs that compare single-agent vs.
multi-agent outcomes on correctness, latency, and token cost.

## Purpose

Phase 8 introduced multi-agent parallelism. Before declaring it the default,
gather evidence that it actually improves correctness, speed, or review quality
compared to single-agent runs on the same task.

## Schema

Each run file is a markdown document named `<run-id>.md` (e.g. `eval-001.md`).
Copy `_template.md` to start a new run.

Required fields (validated by `forgeai-init --check-evaluation`):

| Field | Values |
| --- | --- |
| Run ID | unique slug, e.g. `eval-001` |
| Date | `YYYY-MM-DD` |
| Task | short description of the task |
| Mode | `single-agent` or `multi-agent` |
| Outcome | `pass`, `fail`, or `partial` |

Efficiency fields (validated when present):

| Field | Values |
| --- | --- |
| Latency | `HH:MM:SS` |
| Token cost | non-negative integer |
| Input tokens | non-negative integer |
| Output tokens | non-negative integer |
| Model calls | non-negative integer |
| Files read | non-negative integer |
| Context files | non-negative integer |

Optional descriptive fields:

- Correctness, Agents used, Notes

## When to record a run

Record a run when:
- A Phase 8 multi-agent workflow completes (or fails) for the first time on a task type.
- You want to compare single-agent and multi-agent performance on the same task.
- A review gate returns `Request changes` — useful to track whether multi-agent review caught it first.

## Running the check

```bash
forgeai-init --check-evaluation
```

The check is included in `forgeai-init --check-all`.
