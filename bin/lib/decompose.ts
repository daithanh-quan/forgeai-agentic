import fs from 'node:fs';
import path from 'node:path';
import { root, getArgValue } from './context.js';
import { formatStatus } from './utils.js';

const TODAY = new Date().toISOString().slice(0, 10);

const SCORING_GUIDE = `
Scoring dimensions:
  C = complexity (0–3): 0 mechanical  1 localized  2 multi-file  3 architecture/concurrency
  R = risk       (0–3): 0 docs/tests  1 reversible  2 API/data/broad  3 auth/security/payments/prod
  A = ambiguity  (0–2): 0 explicit   1 assumptions bounded   2 unclear/conflicting
  X = context    (0–2): 0 one file   1 one subsystem   2 broad/cross-system

Tier routing (total score):
  0–2  → fast     (agy, token_budget 4000)
  3–5  → standard (codex, token_budget 8000)
  6–8  → strong   (codex/current model, token_budget 16000)
  9–10 → lead     (current orchestrator, token_budget 24000)

Minimum-tier overrides (regardless of score):
  architecture, auth/security, payments, destructive migrations → lead
  public API changes → strong
`.trim();

export function buildDecompositionTemplate(objective: string): string {
  return `# Task Decomposition

- Objective: ${objective}
- Scored by: orchestrator
- Date: ${TODAY}

## Scoring Table

| Subtask | C | R | A | X | Total | Tier | Agent | Token budget |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| TODO: describe subtask 1 | 0 | 0 | 0 | 0 | 0 | fast | agy | 4000 |
| TODO: describe subtask 2 | 0 | 0 | 0 | 0 | 0 | fast | agy | 4000 |

${SCORING_GUIDE}

## Subtasks

### Subtask 1
- ID: TASK-01
- Role: TODO (research | backend | frontend | reviewer)
- Tier: fast
- Token budget: 4000
- Objective: TODO — one measurable outcome
- Read scope: TODO (exact files or directories)
- Write scope: TODO (exact files or directories)
- Parallel safety: independent | sequential | needs-human-decision
- Acceptance criteria:
  - [ ] TODO
- Validation command: TODO

### Subtask 2
- ID: TASK-02
- Role: TODO
- Tier: fast
- Token budget: 4000
- Objective: TODO
- Read scope: TODO
- Write scope: TODO
- Parallel safety: independent
- Acceptance criteria:
  - [ ] TODO
- Validation command: TODO

## Session coordination

Run before launching parallel subtasks:

\`\`\`bash
forgeai-init --check-sessions
\`\`\`

Record each active session in \`.ai/state/sessions.md\` with a narrow write scope
before starting. See \`.ai/workflows/worktree-strategy.md\` for parallel worktree setup.
`;
}

export function buildCompactDecompositionTemplate(objective: string): string {
  return `# Compact Assignment Plan

- Objective: ${objective}
- Date: ${TODAY}
- Rule: split only when subtasks have distinct write scopes.

## Scoring

| Subtask | C | R | A | X | Total | Tier | Token budget |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| TODO: subtask 1 | 0 | 0 | 0 | 0 | 0 | fast | 4000 |

## Assignment Template

- ID: TASK-01
- Role: TODO
- Objective: TODO: one measurable outcome
- Tier: fast
- Token budget: 4000
- Allowed context:
  - TODO: exact files or context-pack nodes
- Write scope:
  - TODO: exact files only
- Acceptance criteria:
  - [ ] TODO
- Validation:
  - TODO: command or manual check
- Return format:
  - Files changed
  - Summary
  - Validation evidence
  - Risks / unresolved questions

## Context Budget

- Run \`forgeai-init --check-codegraph\`; if the dependency graph is missing or stale, run \`forgeai-init --refresh-codegraph\`.
- Start from \`forgeai-init --context-pack --objective "${objective.replace(/"/g, '\\"')}"\`.
- For delegated execution, compile bounded excerpts with \`forgeai-init --compile-context --objective "${objective.replace(/"/g, '\\"')}" --budget <tokens>\`.
- Send delegated models only this assignment, selected files/excerpts, and validation requirements.
- Do not send full harness docs or broad repository output unless the context pack proves it is needed.
`;
}

export function runDecompose(): void {
  const objective = getArgValue('--objective');
  const outputArg = getArgValue('--output');
  const compact = process.argv.includes('--compact');

  if (!objective) {
    process.stderr.write('Usage: forgeai-init --decompose --objective "<description>" [--output <file>]\n');
    process.exitCode = 2;
    return;
  }

  const content = compact ? buildCompactDecompositionTemplate(objective) : buildDecompositionTemplate(objective);

  if (outputArg) {
    const outputPath = path.resolve(root, outputArg);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    console.log(formatStatus('ok', `decomposition written to ${outputArg}`));
  } else {
    process.stdout.write(content);
  }
}
