import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRetrieval, type RetrievalCase } from '../scripts/context-retrieval.js';
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';
import type { CompiledContextArtifact } from '../bin/lib/types.js';

const source = 'export function dispatch() { return "local"; }';
const scenario: RetrievalCase = {
  id: 'fixture', objective: 'fix dispatch', rationale: 'Inspect dispatch implementation.',
  required: [{ path: 'router.ts', name: 'dispatch' }]
};

function fixture(): CompiledContextArtifact {
  return {
    schema_version: 1, kind: 'forgeai_compiled_context', objective: scenario.objective,
    task_id: null, artifact_role: 'primary', mode: 'compact', experiment_id: null,
    parent_artifact: null, repository: { revision: null, fingerprint: 'fixture' },
    budget: { limit_tokens: 6000, estimated_tokens: 0, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 2, max_nodes: 12, files: [{ path: 'router.ts', depth: 0, reason: 'seed', graph_path: 'router.ts' }] },
    rules: [], diagnostics: {
      git: { available: false, branch: null, revision: null, staged: 0, unstaged: 0,
        untracked: 0, changed_files: [], changed_files_truncated: false, diff: [],
        diff_truncated: false, error: null },
      validation: { package_manager: null, scripts: [] }
    },
    contracts: [], entrypoints: [], omitted_candidates: 0,
    context_exclusions: { profiles: [], rules: [], include_globs: [] }, omitted_context: [],
    excerpts: [{ path: 'router.ts', name: 'dispatch', kind: 'function', mode: 'full',
      reason: 'match', source_start_line: 1, source_end_line: 1, content: source }]
  };
}

function assess(artifact: CompiledContextArtifact) {
  artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
  return assessRetrieval(scenario, artifact, () => source);
}

test('retrieval evaluation requires complete implementation with source provenance', () => {
  const result = assess(fixture());
  assert.equal(result.passed, true);
  assert.equal(result.implementation_recall, 1);
  assert.equal(result.requirements[0].status, 'full');
});

test('retrieval evaluation distinguishes selected files, signatures, and missing implementations', () => {
  const artifact = fixture();
  artifact.excerpts[0].mode = 'signature';
  assert.equal(assess(artifact).requirements[0].status, 'signature-only');
  assert.equal(assess(artifact).passed, false);
  artifact.excerpts[0].mode = 'full';
  artifact.excerpts[0].kind = 'import';
  assert.equal(assess(artifact).requirements[0].status, 'missing');
  artifact.excerpts = [];
  const result = assess(artifact);
  assert.equal(result.requirements[0].selected, true);
  assert.equal(result.implementation_recall, 0);
  assert.equal(result.passed, false);
});

test('retrieval evaluation rejects fabricated content and invalid source lines', () => {
  for (const change of [
    { content: 'invented implementation' }, { content: '' },
    { source_start_line: 0 }, { source_end_line: 999 }, { source_start_line: 1.5 }
  ]) {
    const artifact = fixture();
    Object.assign(artifact.excerpts[0], change);
    assert.equal(assess(artifact).requirements[0].status, 'invalid-provenance');
    assert.equal(assess(artifact).passed, false);
  }
});

test('retrieval evaluation rejects incorrect budget accounting and over-budget payloads', () => {
  const artifact = fixture();
  assert.equal(assessRetrieval(scenario, artifact, () => source).budget_valid, false);
  artifact.budget.limit_tokens = 1;
  assert.equal(assess(artifact).budget_valid, false);
  assert.equal(assess(artifact).passed, false);
});
