# ForgeAI 3.16.0 local trial — 2026-10-12

## Method

Ran the compiled CLI from the actual `npm pack` tarball against the ForgeAI
working tree and a fresh TypeScript fixture. The extracted package reused the
workspace's installed node_modules; this is not a clean dependency installation
test. No model was called, no npm package was published, and no external users
participated. Expected files below were chosen manually before running queries.

## Default budget: 6,000 estimated tokens

| Objective | Expected file | Selected | Any excerpt from expected file | Estimated tokens |
| --- | --- | --- | --- | ---: |
| fix router fallback | bin/lib/router.ts | Yes | No | 5,940 |
| fix context budget estimation | bin/lib/context-compiler.ts | Yes | Yes | 5,932 |
| fix profile detection | bin/lib/profiles.ts | Yes | Yes | 5,950 |
| fix task validation | bin/lib/task.ts | Yes | Yes | 5,933 |
| fix source import analysis | bin/lib/source-analysis.ts | Yes | Yes | 5,999 |

Every query selected 12 files and stayed within its estimated artifact budget.
All five omitted candidates. An excerpt may be an import or signature: its
presence does not prove the implementation needed to solve the task is present.

Increasing the router query budget to 12,000 included ten import excerpts from
router.ts, but still no implementation excerpt from that file. Increasing the
budget alone is therefore not evidence that this task has adequate context.
The next retrieval improvement should prioritize useful implementation excerpts
from objective-matched files and explicitly report selected files lacking them.

## Other checks

- After the version bump, `npm test` passed typecheck, build, and all 941 tests;
  `git diff --check` also passed.
- Fresh repository: loginRedirect source and line provenance printed correctly;
  the directory still contained only the original login.ts afterward.
- Vietnamese objective `sửa lỗi chuyển đổi mô hình`: actionable no-match error,
  exit code 1, and empty stdout. Semantic translation is not supported.
- Tarball CLI reported version 3.16.0 and contained the new command and assets.
- These are local smoke tests, not user research or a task-success benchmark.
