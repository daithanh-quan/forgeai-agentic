import assert from 'node:assert/strict';
import test from 'node:test';
import { checkArtifactStructure } from '../bin/lib/router.js';

// A minimal structurally-valid compiled-context artifact (no fingerprint check).
function baseArtifact(): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: 'demo',
    task_id: null,
    artifact_role: 'primary',
    repository: { revision: null, fingerprint: 'abc' },
    budget: { limit_tokens: 4000, estimated_tokens: 10, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 1, max_nodes: 5, files: [{ path: 'a.ts', depth: 0, reason: 'seed', graph_path: 'a.ts' }] },
    rules: [],
    diagnostics: {},
    contracts: [],
    entrypoints: [],
    excerpts: [],
    omitted_candidates: 0,
  };
}

function exclusionPolicy(): Record<string, unknown> {
  return {
    profiles: ['p'], include_globs: [],
    rules: [{ pattern: 'x/', reason: 'r', profiles: ['p'] }],
  };
}

test('checkArtifactStructure accepts absent mode/experiment_id (legacy)', () => {
  assert.equal(checkArtifactStructure(baseArtifact()), null);
});

test('checkArtifactStructure accepts valid mode and experiment_id', () => {
  assert.equal(checkArtifactStructure({ ...baseArtifact(), mode: 'baseline', experiment_id: 'EXP-20260727-x' }), null);
  assert.equal(checkArtifactStructure({ ...baseArtifact(), mode: 'compact', experiment_id: null }), null);
});

test('checkArtifactStructure rejects unknown mode and malformed experiment_id', () => {
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), mode: 'full' })), /mode must be/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), experiment_id: '' })), /experiment_id must be/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), experiment_id: 'EXP-1' })), /experiment_id must be/);
});

test('checkArtifactStructure accepts a whole-file excerpt of kind "file"', () => {
  const a = baseArtifact();
  a.excerpts = [{
    path: 'a.ts', kind: 'file', name: 'a.ts', reason: 'baseline: whole selected file',
    source_start_line: 1, source_end_line: 12, mode: 'full', content: 'export const x = 1;\n',
  }];
  assert.equal(checkArtifactStructure(a), null);
});

test('checkArtifactStructure accepts a missing, null, or string parent_artifact and rejects other types', () => {
  assert.equal(checkArtifactStructure(baseArtifact()), null); // absent is fine
  assert.equal(checkArtifactStructure({ ...baseArtifact(), parent_artifact: null }), null);
  assert.equal(checkArtifactStructure({ ...baseArtifact(), parent_artifact: '.ai/state/context/P.json' }), null);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), parent_artifact: 5 })), /parent_artifact must be null or a string/);
});

test('checkArtifactStructure accepts absent context_exclusions/omitted_context (legacy)', () => {
  assert.equal(checkArtifactStructure(baseArtifact()), null);
});

test('checkArtifactStructure accepts well-formed context_exclusions and omitted_context', () => {
  const a = baseArtifact();
  a.context_exclusions = {
    profiles: ['django'], include_globs: [],
    rules: [{ pattern: 'migrations/', reason: 'auto-generated migrations', profiles: ['django'] }],
  };
  a.omitted_context = [{ path: 'src/migrations/0001.ts', pattern: 'migrations/', reason: 'auto-generated migrations', profiles: ['django'] }];
  assert.equal(checkArtifactStructure(a), null);
});

test('checkArtifactStructure rejects malformed context_exclusions', () => {
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), context_exclusions: [], omitted_context: [] })), /context_exclusions must be an object/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), context_exclusions: { profiles: [1], include_globs: [], rules: [] }, omitted_context: [] })), /profiles must be an array of strings/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), context_exclusions: { profiles: [], include_globs: [], rules: [{ pattern: '', reason: 'x', profiles: [] }] }, omitted_context: [] })), /rules\[\].pattern must be/);
});

test('checkArtifactStructure rejects unsorted omitted_context and overlap with selection.files', () => {
  const unsorted = baseArtifact();
  unsorted.context_exclusions = exclusionPolicy();
  unsorted.omitted_context = [
    { path: 'b.ts', pattern: 'x/', reason: 'r', profiles: ['p'] },
    { path: 'a.ts', pattern: 'x/', reason: 'r', profiles: ['p'] },
  ];
  assert.match(String(checkArtifactStructure(unsorted)), /omitted_context must be sorted and unique by path/);

  const overlap = baseArtifact();
  overlap.context_exclusions = exclusionPolicy();
  // baseArtifact selection.files contains 'a.ts'
  overlap.omitted_context = [{ path: 'a.ts', pattern: 'x/', reason: 'r', profiles: ['p'] }];
  assert.match(String(checkArtifactStructure(overlap)), /also appears in selection\.files/);
});

test('checkArtifactStructure rejects incomplete, non-deterministic, or contradictory exclusion policy', () => {
  assert.match(
    String(checkArtifactStructure({ ...baseArtifact(), context_exclusions: exclusionPolicy() })),
    /must either both be present or both be absent/
  );

  const duplicateProfiles = baseArtifact();
  duplicateProfiles.context_exclusions = {
    profiles: ['p', 'p'], include_globs: [], rules: []
  };
  duplicateProfiles.omitted_context = [];
  assert.match(String(checkArtifactStructure(duplicateProfiles)), /sorted, unique/);

  const unknownRuleProfile = baseArtifact();
  unknownRuleProfile.context_exclusions = {
    profiles: ['p'], include_globs: [],
    rules: [{ pattern: 'x/', reason: 'r', profiles: ['q'] }]
  };
  unknownRuleProfile.omitted_context = [];
  assert.match(String(checkArtifactStructure(unknownRuleProfile)), /must be included/);

  const unmatchedOmission = baseArtifact();
  unmatchedOmission.context_exclusions = exclusionPolicy();
  unmatchedOmission.omitted_context = [
    { path: 'b.ts', pattern: 'other/', reason: 'r', profiles: ['p'] }
  ];
  assert.match(String(checkArtifactStructure(unmatchedOmission)), /must reference a rule/);
});
