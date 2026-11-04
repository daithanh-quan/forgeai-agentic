import type { CompiledContextArtifact } from '../bin/lib/types.js';

export type RetrievalCase = {
  id: string;
  objective: string;
  rationale: string;
  required: Array<{ path: string; name: string }>;
};

// Expectations describe the implementation needed to investigate each task.
// Keep misses visible; do not replace a required symbol with whatever was retrieved.
export const retrievalCases: RetrievalCase[] = [
  {
    id: 'router-fallback', objective: 'fix router fallback',
    rationale: 'Inspect both CLI fallback and API-to-CLI fallback behavior.',
    required: ['routeCliAdapter', 'routeToAdapter'].map(name => ({ path: 'bin/lib/router.ts', name }))
  },
  {
    id: 'budget-estimation', objective: 'fix context budget estimation',
    rationale: 'Inspect token estimation and both artifact estimate stabilization paths.',
    required: ['estimateTokens', 'stableArtifactEstimate', 'computeArtifactEstimate']
      .map(name => ({ path: 'bin/lib/context-compiler.ts', name }))
  },
  {
    id: 'profile-detection', objective: 'fix profile detection',
    rationale: 'Inspect stack detection from repository evidence.',
    required: [{ path: 'bin/lib/profiles.ts', name: 'detectProjectProfile' }]
  },
  {
    id: 'task-validation', objective: 'fix task validation',
    rationale: 'Inspect validation orchestration and execution of an individual check.',
    required: ['runTaskValidation', 'runValidationScript'].map(name => ({ path: 'bin/lib/task.ts', name }))
  },
  {
    id: 'import-analysis', objective: 'fix source import analysis',
    rationale: 'Inspect the syntax walker that records imports.',
    required: [{ path: 'bin/lib/source-analysis.ts', name: 'analyzeSource' }]
  }
];

export function assessRetrieval(
  scenario: RetrievalCase,
  artifact: CompiledContextArtifact,
  readSource: (file: string) => string
) {
  const requirements = scenario.required.map(required => {
    const excerpts = artifact.excerpts.filter(excerpt =>
      excerpt.path === required.path && excerpt.name === required.name);
    const full = excerpts.filter(excerpt => excerpt.mode === 'full' && excerpt.kind !== 'import');
    const verified = full.some(excerpt => {
      const lines = readSource(required.path).split('\n');
      return Number.isInteger(excerpt.source_start_line) && Number.isInteger(excerpt.source_end_line)
        && excerpt.source_start_line >= 1 && excerpt.source_end_line >= excerpt.source_start_line
        && excerpt.source_end_line <= lines.length && excerpt.content.trim().length > 0
        && lines.slice(excerpt.source_start_line - 1, excerpt.source_end_line).join('\n').includes(excerpt.content);
    });
    return {
      ...required,
      selected: artifact.selection.files.some(file => file.path === required.path),
      status: verified ? 'full' : full.length ? 'invalid-provenance'
        : excerpts.some(excerpt => excerpt.mode === 'signature') ? 'signature-only' : 'missing'
    };
  });
  const estimated = Math.ceil(`${JSON.stringify(artifact, null, 2)}\n`.length / 4);
  const budgetValid = estimated === artifact.budget.estimated_tokens && estimated <= artifact.budget.limit_tokens;
  const fullCount = requirements.filter(required => required.status === 'full').length;
  return {
    id: scenario.id, objective: scenario.objective, rationale: scenario.rationale,
    repository: artifact.repository,
    estimated_tokens: estimated, budget: artifact.budget.limit_tokens,
    budget_valid: budgetValid,
    selected_files: artifact.selection.files.length,
    required_implementations: requirements.length,
    full_implementations: fullCount,
    implementation_recall: requirements.length ? fullCount / requirements.length : 0,
    passed: budgetValid && requirements.length > 0
      && requirements.every(required => required.selected && required.status === 'full'),
    requirements
  };
}
