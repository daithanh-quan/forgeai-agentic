import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, runTs } from './helpers.js';
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';
import type { CompiledContextArtifact } from '../bin/lib/types.js';

test('context retrieves private estimation helpers across TypeScript and Python naming styles', () => {
  for (const [file, source, names] of [
    ['meter.ts',
      'export function meter() { return 0; }\n'
      + 'function estimateCost(value: number) { return value / 4; }\n'
      + 'function stabilizeEstimate(value: number) { return Math.ceil(estimateCost(value)); }\n',
      ['estimateCost', 'stabilizeEstimate']],
    ['meter.py',
      'def meter():\n    return 0\n\n'
      + 'def _estimate_cost(value):\n    return value / 4\n\n'
      + 'def _stabilize_estimate(value):\n    return round(_estimate_cost(value))\n',
      ['_estimate_cost', '_stabilize_estimate']]
  ] as const) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-inflections-'));
    try {
      fs.writeFileSync(path.join(cwd, file), source);
      const args = ['context', 'meter estimation', '--budget', '1800', '--json'];
      const output = runTs(cli, args, { cwd });
      const artifact = JSON.parse(output) as CompiledContextArtifact;
      for (const name of names) {
        const excerpt = artifact.excerpts.find(item => item.path === file && item.name === name);
        assert.equal(excerpt?.mode, 'full', `${file}: expected full ${name}`);
        assert.ok(source.includes(excerpt!.content));
      }
      assert.equal(artifact.budget.estimated_tokens, computeArtifactEstimate(artifact));
      assert.ok(artifact.budget.estimated_tokens <= 1800);
      assert.equal(runTs(cli, args, { cwd }), output);
      assert.deepEqual(fs.readdirSync(cwd), [file]);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('context retains implementation body matches before matching tests and imports', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-retrieval-'));
  try {
    fs.writeFileSync(path.join(cwd, 'router.ts'),
      Array.from({ length: 20 }, (_, i) => `import { dep${i} } from 'external-${i}';`).join('\n')
      + '\nfunction dispatch() { const fallback = "local"; return fallback; }\n'
      + 'export function execute() { return dispatch(); }\n');
    fs.writeFileSync(path.join(cwd, 'aaa.test.ts'), Array.from({ length: 30 }, (_, i) =>
      `test('router fallback case ${i}', () => { const value = '${'x'.repeat(100)}'; });`).join('\n'));
    const args = ['context', 'router fallback', '--budget', '1800', '--json'];
    const output = runTs(cli, args, { cwd });
    const artifact = JSON.parse(output) as CompiledContextArtifact;
    const implementation = artifact.excerpts.find((excerpt) => excerpt.name === 'dispatch');
    assert.equal(implementation?.mode, 'full');
    assert.match(implementation!.content, /return fallback/);
    assert.match(implementation!.reason, /objective term found/);
    assert.equal(artifact.excerpts[0].name, 'dispatch');
    assert.ok(artifact.omitted_candidates > 0);
    assert.equal(artifact.budget.estimated_tokens, computeArtifactEstimate(artifact));
    assert.ok(artifact.budget.estimated_tokens <= 1800);
    assert.equal(runTs(cli, args, { cwd }), output);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('context identifies selected files containing only signature excerpts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-coverage-'));
  try {
    fs.writeFileSync(path.join(cwd, 'router.ts'),
      `export function router() {\n${Array.from({ length: 500 }, (_, i) => `const value${i} = ${i};`).join('\n')}\nreturn value499;\n}`);
    const markdown = runTs(cli, ['context', 'router', '--budget', '1800'], { cwd });
    assert.match(markdown, /Selected files without full implementation excerpts: router.ts/);
    assert.match(markdown, /Mode: signature/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('context works before initialization, emits usable source, and creates no files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-command-'));
  try {
    const source = 'export function loginRedirect() { return "/dashboard"; }\n';
    fs.writeFileSync(path.join(cwd, 'login.ts'), source);
    const markdown = runTs(cli, ['context', 'loginRedirect'], { cwd });
    assert.match(markdown, /return "\/dashboard"/);
    assert.match(markdown, /login.ts:1/);
    assert.match(markdown, /not proof that all required code is present/);
    const artifact = JSON.parse(runTs(cli, ['context', '--budget=8000', '--objective', 'loginRedirect', '--json'], { cwd }));
    assert.equal(artifact.kind, 'forgeai_compiled_context');
    assert.equal(artifact.selection.files[0].path, 'login.ts');
    assert.ok(artifact.budget.estimated_tokens <= 8000);
    assert.deepEqual(fs.readdirSync(cwd), ['login.ts']);
    assert.equal(fs.readFileSync(path.join(cwd, 'login.ts'), 'utf8'), source);
    runTs(cli, ['context', 'loginRedirect', '--output', 'context.md'], { cwd });
    assert.match(fs.readFileSync(path.join(cwd, 'context.md'), 'utf8'), /loginRedirect/);
    assert.throws(() => runTs(cli, ['context', 'loginRedirect', '--output', 'login.ts'], { cwd }), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(cwd, 'login.ts'), 'utf8'), source);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('context fails clearly on missing matches and invalid options without writes', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-invalid-'));
  try {
    fs.writeFileSync(path.join(cwd, 'login.ts'), 'export const login = true;\n');
    assert.throws(() => runTs(cli, ['context', 'zzzzunknown', '--output', 'missing.md'], { cwd }), /No matching source files/);
    for (const args of [[], ['login', '--budget', 'abc'], ['login', '--max-depth', '8'], ['login', '--budegt', '1000'], ['login', '--objective', 'other'], ['login', '--budget', '256']]) {
      assert.throws(() => runTs(cli, ['context', ...args], { cwd }));
    }
    assert.deepEqual(fs.readdirSync(cwd), ['login.ts']);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
