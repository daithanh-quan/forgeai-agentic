import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';
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

test('computeArtifactEstimate does not mutate input artifact', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-estimate-pure-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    const declared = artifact.budget.estimated_tokens;
    const recomputed = computeArtifactEstimate(artifact);
    // Input must not have been mutated
    assert.equal(artifact.budget.estimated_tokens, declared, 'computeArtifactEstimate must not mutate input');
    // Result must be consistent with declared (valid artifact)
    assert.equal(recomputed, declared);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context stamps task_id and primary role when --task is given', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-task-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000', '--task', 'TASK-20260724-routing']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    assert.equal(artifact.task_id, 'TASK-20260724-routing');
    assert.equal(artifact.artifact_role, 'primary');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context defaults task_id to null', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-notask-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    assert.equal(artifact.task_id, null);
    assert.equal(artifact.artifact_role, 'primary');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context rejects a malformed --task', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-badtask-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000', '--task', 'not-a-task']);
    assert.equal(result.failed, true);
    assert.equal(result.error?.status, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compile-context extracts private and exported symbol-level callers in dependent files and packs matching .ai/MEMORY.md entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-callers-memory-'));
  try {
    initializeFixture(target);
    // Add a dependent file that imports formatDiagnostics from diagnostics.ts
    // with a private caller function and an unrelated exported function.
    fs.writeFileSync(
      path.join(target, 'src', 'controller.ts'),
      [
        "import { formatDiagnostics } from './diagnostics.js';",
        'function internalCallerHelper() {',
        '  return formatDiagnostics();',
        '}',
        'export function unrelatedControllerExport() {',
        '  return "noop";',
        '}'
      ].join('\n') + '\n'
    );
    // Populate .ai/MEMORY.md with one matching decision (referencing src/diagnostics.ts)
    // and one unrelated decision, plus an unfilled TODO section.
    fs.writeFileSync(
      path.join(target, '.ai', 'MEMORY.md'),
      [
        '<!-- forgeai-memory: max-age-days=180 -->',
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2026-11-20 — Diagnostics output contract',
        '- **Decision:** Keep `src/diagnostics.ts` deterministic and side-effect free.',
        '- **Why:** Downstream callers parse diagnostic strings directly.',
        '- **Impact:** All callers of `formatDiagnostics` rely on stable string formatting.',
        '',
        '### 2026-11-21 — Billing webhook retry policy',
        '- **Decision:** Retry billing webhooks up to 3 times.',
        '- **Why:** Payment gateway timeouts.',
        '- **Impact:** Billing workers only.',
        '',
        '## Business rules',
        '- TODO: Unfilled template placeholder must be ignored.'
      ].join('\n') + '\n'
    );
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const result = runCompile(target, ['--objective', 'update formatDiagnostics output', '--budget', '6000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;

    // 1. Private caller function in dependent file src/controller.ts is extracted with caller provenance
    const privateCaller = artifact.excerpts.find(
      (e) => e.path === 'src/controller.ts' && e.name === 'internalCallerHelper'
    );
    assert.ok(privateCaller, 'private caller in dependent file must be extracted');
    assert.match(privateCaller.reason, /caller of "formatDiagnostics"/);

    // 2. Private caller is packed ahead of unrelated export in dependent file
    const callerIdx = artifact.excerpts.findIndex((e) => e.name === 'internalCallerHelper');
    const unrelatedIdx = artifact.excerpts.findIndex((e) => e.name === 'unrelatedControllerExport');
    assert.ok(callerIdx !== -1 && (unrelatedIdx === -1 || callerIdx < unrelatedIdx));

    // 3. Applicable memory decision from .ai/MEMORY.md is packed; unrelated decision and TODO section are excluded
    const memoryRules = artifact.rules.filter((r) => r.path === '.ai/MEMORY.md');
    assert.equal(memoryRules.length, 1);
    assert.match(memoryRules[0].heading, /Diagnostics output contract/);
    assert.match(memoryRules[0].reason, /src\/diagnostics\.ts/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
