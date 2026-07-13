import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

function writeCompilerFixture(target: string, largeBody = false): void {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  const body = largeBody
    ? `\n  ${Array.from({ length: 400 }, (_, index) => `const value${index} = ${index};`).join('\n  ')}\n  return value399;\n`
    : '\n  return formatDiagnostics();\n';
  fs.writeFileSync(
    path.join(target, 'src', 'entry.ts'),
    `${largeBody ? '' : "import { formatDiagnostics } from './diagnostics.js';\n"}export function runCli() {${body}}\n`
  );
  fs.writeFileSync(
    path.join(target, 'src', 'diagnostics.ts'),
    "import { sharedValue } from './shared.js';\nexport function formatDiagnostics() { return String(sharedValue); }\n"
  );
  fs.writeFileSync(path.join(target, 'src', 'shared.ts'), 'export const sharedValue = 42;\n');
  fs.writeFileSync(
    path.join(target, 'test', 'entry.test.ts'),
    "import { runCli } from '../src/entry.js';\ntest('runCli returns diagnostics', () => { assert.equal(runCli(), '42'); });\n"
  );
}

function initializeFixture(target: string, largeBody = false): void {
  runTs(cli, [], { cwd: target });
  writeCompilerFixture(target, largeBody);
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
}

function runCompile(target: string, args: string[]): { output: string; failed: boolean; error?: ExecError } {
  try {
    return { output: runTs(cli, ['--compile-context', ...args], { cwd: target }), failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return {
      output: `${String(execError.stdout ?? '')}${String(execError.stderr ?? '')}`,
      failed: true,
      error: execError
    };
  }
}

test('compile-context emits bounded syntax excerpts with provenance', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-context-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;

    assert.equal(artifact.schema_version, 1);
    assert.equal(artifact.kind, 'forgeai_compiled_context');
    assert.equal(artifact.objective, 'change runCli implementation');
    assert.ok(artifact.budget.estimated_tokens <= artifact.budget.limit_tokens);
    assert.equal(artifact.budget.estimated_tokens, Math.ceil(result.output.length / 4));
    assert.ok(artifact.rules.some((rule) => rule.heading === 'Non-negotiable safety rules'));
    assert.ok(artifact.rules.some((rule) => rule.heading === 'Validation order'));
    assert.equal(artifact.rules.some((rule) => rule.heading === 'Dependency rules'), false);
    assert.equal(artifact.diagnostics.git.available, false);
    assert.ok(artifact.excerpts.some((excerpt) =>
      excerpt.path === 'src/entry.ts'
      && excerpt.kind === 'function'
      && excerpt.name === 'runCli'
      && excerpt.mode === 'full'
      && excerpt.content.includes('return formatDiagnostics()')
    ));
    assert.ok(artifact.excerpts.some((excerpt) =>
      excerpt.path === 'test/entry.test.ts'
      && excerpt.kind === 'test'
      && excerpt.name === 'runCli returns diagnostics'
    ));
    assert.ok(artifact.excerpts.every((excerpt) => excerpt.source_start_line > 0 && excerpt.source_end_line >= excerpt.source_start_line));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context falls back to a whole signature instead of truncating a large function', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-signature-'));
  try {
    initializeFixture(target, true);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '1800']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    const runCli = artifact.excerpts.find((excerpt) => excerpt.name === 'runCli');

    assert.ok(runCli);
    assert.equal(runCli.mode, 'signature');
    assert.match(runCli.content, /export function runCli\(\)/);
    assert.match(runCli.content, /body omitted/);
    assert.doesNotMatch(runCli.content, /value399/);
    assert.equal(artifact.budget.exhausted, true);
    assert.ok(artifact.budget.estimated_tokens <= 1800);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context writes JSON source of truth and Markdown inspection output', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-files-'));
  try {
    initializeFixture(target);
    const outputFile = '.ai/state/context/run-cli.json';
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--output', outputFile]);

    assert.equal(result.failed, false);
    assert.match(result.output, /compiled context JSON written/);
    const jsonPath = path.join(target, outputFile);
    const markdownPath = path.join(target, '.ai/state/context/run-cli.md');
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(markdownPath), true);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    assert.match(markdown, /ForgeAI Compiled Context/);
    assert.match(markdown, /src\/entry\.ts:/);
    assert.match(markdown, /export function runCli/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context is deterministic for the same objective and repository fingerprint', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-deterministic-'));
  try {
    initializeFixture(target);
    const args = ['--objective', 'change runCli implementation', '--budget', '4000'];
    const first = runCompile(target, args);
    const second = runCompile(target, args);

    assert.equal(first.failed, false);
    assert.equal(second.failed, false);
    assert.equal(first.output, second.output);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context packs task-applicable dependency and supply-chain rules', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-rules-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'install parser dependency', '--budget', '5000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;

    assert.ok(artifact.rules.some((rule) => rule.heading === 'Dependency rules'));
    assert.ok(artifact.rules.some((rule) => rule.heading === 'Supply-chain and untrusted-source safety'));
    assert.equal(new Set(artifact.rules.map((rule) => rule.content)).size, artifact.rules.length);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context rejects a budget too small for required rules and diagnostics', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-small-budget-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '256']);

    assert.equal(result.failed, true);
    assert.equal(result.error?.status, 2);
    assert.match(result.output, /budget 256 is too small for required selection, rules, and diagnostics/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
