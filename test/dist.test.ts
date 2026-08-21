import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { projectRoot } from './helpers.js';

const distCli = path.join(projectRoot, 'dist', 'forgeai-init.js');

// Run the compiled CLI with plain node — no tsx loader — the way an npm
// install executes the published bin.
function runDist(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [distCli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' }
  }) as string;
}

test('npm artifact includes templates/.ai/codegraph/graph.json required by --repair-codegraph', () => {
  const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-npm-cache-'));
  try {
    const packOutput = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    })) as Array<{ files: Array<{ path: string }> }>;
    const files = packOutput[0].files.map((f) => f.path);
    assert.ok(
      files.some((f) => f.endsWith('templates/.ai/codegraph/graph.json')),
      `graph.json template must be packaged for --repair-codegraph\nPackaged template files: ${files.filter((f) => f.includes('template')).join('\n')}`
    );
  } finally {
    fs.rmSync(npmCache, { recursive: true, force: true });
  }
});

test('compiled dist CLI help contains Phase 11 commands', () => {
  const output = runDist(['--help'], projectRoot);
  assert.match(output, /--validate-artifact/);
  assert.match(output, /--route/);
  assert.match(output, /--expand-context/);
});

test('compiled dist CLI starts with a plain node shebang', () => {
  const firstLine = fs.readFileSync(distCli, 'utf8').split('\n')[0];
  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('compiled dist CLI reports the package version without tsx', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  const output = runDist(['--version'], projectRoot);
  assert.equal(output.trim(), packageJson.version);
});

test('compiled dist CLI initializes a harness and passes --check', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-init-'));
  try {
    runDist([], target);
    assert.ok(fs.existsSync(path.join(target, '.ai', 'RULES.md')));
    const output = runDist(['--check'], target);
    assert.match(output, /Result: harness installed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compiled dist CLI refreshes a dependency graph without tsx', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-codegraph-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'dependency.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(target, 'src', 'entry.ts'), "export { value } from './dependency.js';\n");

    const output = runDist(['--refresh-codegraph'], target);

    assert.match(output, /2 source files/);
    assert.ok(fs.existsSync(path.join(target, '.ai', 'codegraph', 'dependency-graph.json')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compiled dist CLI reads migration docs from docs/migrations/', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-notes-'));
  try {
    runDist([], target);

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { package_version: string };
    manifest.package_version = '3.2.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const output = runDist(['--upgrade'], target);
    assert.match(output, /Migration notes/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compiled dist CLI help contains --check-upgrade', () => {
  const output = runDist(['--help'], projectRoot);
  assert.match(output, /--check-upgrade/);
});

test('compiled dist CLI --check-upgrade exits 0 on a fresh install', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-cu-'));
  try {
    runDist([], target);

    const output = runDist(['--check-upgrade'], target);

    assert.match(output, /\bok\b/i);
    assert.match(output, /harness.*matches CLI/i);
    assert.doesNotMatch(output, /initialized/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('ci-templates/github/forgeai.yml exists in the package source', () => {
  const templatePath = path.join(projectRoot, 'ci-templates', 'github', 'forgeai.yml');
  assert.ok(fs.existsSync(templatePath), 'ci-templates/github/forgeai.yml must exist');
});

test('ci-templates/github/forgeai.yml has required workflow structure', () => {
  const templatePath = path.join(projectRoot, 'ci-templates', 'github', 'forgeai.yml');
  const content = fs.readFileSync(templatePath, 'utf8');

  // Top-level workflow keys
  assert.ok(content.includes('name: ForgeAI Harness'), 'workflow must have name: ForgeAI Harness');
  assert.ok(content.includes('on:'), 'workflow must have on: trigger');
  assert.ok(content.includes('jobs:'), 'workflow must have a jobs section');

  // All five job IDs
  assert.ok(content.includes('upgrade-check:'), 'workflow must have upgrade-check job');
  assert.ok(content.includes('harness-check:'), 'workflow must have harness-check job');
  assert.ok(content.includes('security:'), 'workflow must have security job');
  assert.ok(content.includes('codegraph:'), 'workflow must have codegraph job');
  assert.ok(content.includes('review:'), 'workflow must have review job');

  // All five commands contain @VERSION (not @latest or a pinned semver)
  assert.ok(content.includes('--check-upgrade'), 'workflow must run --check-upgrade');
  assert.ok(content.includes('--check-security'), 'workflow must run --check-security');
  assert.ok(content.includes('--check-codegraph'), 'workflow must run --check-codegraph');
  assert.ok(content.includes('--check-review'), 'workflow must run --check-review');
  assert.ok(content.match(/npx --yes forgeai-agentic-init@VERSION/g)?.length === 5,
    'all 5 jobs must use npx --yes forgeai-agentic-init@VERSION');
  assert.ok(content.includes('--check-codegraph --strict'), 'codegraph job must use --strict flag');

  // No needs: — all jobs must run in parallel
  assert.ok(!content.includes('needs:'), 'workflow must not have needs: (jobs must run in parallel)');

  // Least-privilege permissions
  assert.ok(content.includes('permissions:'), 'workflow must declare permissions');
  assert.ok(content.includes('contents: read'), 'workflow must use contents: read permission');
});

test('ci-templates/github/forgeai.yml is included in the npm package', () => {
  const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-npm-cache-'));
  try {
    const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    });
    const [packResult] = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
    const filePaths = packResult.files.map((f) => f.path);
    assert.ok(
      filePaths.includes('ci-templates/github/forgeai.yml'),
      'ci-templates/github/forgeai.yml must be included in the npm package'
    );
  } finally {
    fs.rmSync(npmCache, { recursive: true, force: true });
  }
});

test('compiled dist CLI creates a bounded context artifact without tsx', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-compile-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'dependency.ts'), 'export const value = 1;\n');
    fs.writeFileSync(
      path.join(target, 'src', 'entry.ts'),
      "import { value } from './dependency.js';\nexport function readValue() { return value; }\n"
    );
    runDist(['--refresh-codegraph'], target);

    const artifact = JSON.parse(runDist([
      '--compile-context', '--objective', 'change readValue', '--budget', '2000'
    ], target)) as CompiledContextArtifact;

    assert.equal(artifact.kind, 'forgeai_compiled_context');
    assert.ok(artifact.excerpts.some((excerpt) => excerpt.name === 'readValue'));
    assert.ok(artifact.budget.estimated_tokens <= 2000);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── helpers for try E2E tests ──────────────────────────────────────────────────

type RunDistResult = { stdout: string; stderr: string; exitCode: number };

function runDistResult(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {}
): RunDistResult {
  const baseEnv = { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1', ...extraEnv };
  try {
    const stdout = execFileSync(process.execPath, [distCli, ...args], {
      cwd,
      encoding: 'utf8',
      env: baseEnv,
    }) as string;
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

function snapshotFiles(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        const content = fs.readFileSync(abs);
        result.set(rel, crypto.createHash('sha256').update(content).digest('hex'));
      }
    }
  }
  walk(dir);
  return result;
}

// ── try subcommand E2E tests ───────────────────────────────────────────────────

test('try: writes no files — content snapshot is identical before and after', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-nowrite-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    const before = snapshotFiles(target);
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0, `try exited with ${result.exitCode}: ${result.stderr}`);
    assert.match(result.stdout, /src\/auth\.ts/);
    const after = snapshotFiles(target);
    assert.deepEqual([...before.entries()], [...after.entries()], 'no files must be written or modified');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: --help mentions forgeai-init try', () => {
  const result = runDistResult(['--help'], projectRoot);
  assert.ok(result.stdout.includes('forgeai-init try'), result.stdout);
});

test('try: no objective exits 2', () => {
  const result = runDistResult(['try'], projectRoot);
  assert.equal(result.exitCode, 2);
});

test('try: --objective with flag-like value exits 2', () => {
  const result = runDistResult(['try', '--objective', '--bad'], projectRoot);
  assert.equal(result.exitCode, 2);
});

test('try: --objective=--bad exits 2', () => {
  const result = runDistResult(['try', '--objective=--bad'], projectRoot);
  assert.equal(result.exitCode, 2);
});

test('try: --objective= (empty) exits 2', () => {
  const result = runDistResult(['try', '--objective='], projectRoot);
  assert.equal(result.exitCode, 2);
});

test('try: duplicate --objective exits 2', () => {
  const result = runDistResult(['try', '--objective', 'auth', '--objective', 'billing'], projectRoot);
  assert.equal(result.exitCode, 2);
});

test('try: empty source dir exits 0 with no-match message', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-empty-'));
  try {
    const result = runDistResult(['try', 'add auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('ForgeAI context proof'), result.stdout);
    assert.ok(result.stdout.includes('no objective-matched files'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: bypasses update preflight even when a newer version is available', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-preflight-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    const result = runDistResult(
      ['try', 'add auth'],
      target,
      { CI: '', FORGEAI_SKIP_UPDATE_CHECK: '', FORGEAI_TEST_LATEST_VERSION: '99.0.0' }
    );
    assert.ok(result.stdout.includes('ForgeAI context proof'), result.stdout);
    assert.ok(!result.stdout.includes('ForgeAI update'), `Update check must not run: ${result.stdout}`);
    assert.ok(!result.stdout.includes('99.0.0'), `Version banner must not appear: ${result.stdout}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── try: exclusion metric E2E ──────────────────────────────────────────────────

test('try: output contains "% excluded" when repo has source files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-pct-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    fs.writeFileSync(path.join(target, 'src', 'payment.ts'), 'export function charge() {}\n');
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0, `try failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('% excluded'), `missing exclusion metric:\n${result.stdout}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: no "indexed source" line when repo has no parseable source files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-nopct-'));
  try {
    // Only a markdown file — no parseable source for dep graph
    fs.writeFileSync(path.join(target, 'README.md'), '# hello\n');
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('indexed source'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── try: CTA state detection E2E ──────────────────────────────────────────────

test('try: CTA=uninitialized when no graph.json exists', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-uninit-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('--profile auto'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: CTA=graph-unreadable when graph.json is a directory', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-unreadable-'));
  try {
    // Use mkdir instead of chmod 000 — EISDIR is cross-platform stable
    fs.mkdirSync(path.join(target, '.ai', 'codegraph', 'graph.json'), { recursive: true });
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('cannot be read'), result.stdout);
    assert.ok(result.stdout.includes('read permission'), result.stdout);
    assert.ok(!result.stdout.includes('--repair-codegraph'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: CTA=needs-reinit when graph.json is malformed JSON', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-reinit-'));
  try {
    fs.mkdirSync(path.join(target, '.ai', 'codegraph'), { recursive: true });
    fs.writeFileSync(path.join(target, '.ai', 'codegraph', 'graph.json'), 'not json {{{');
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('--repair-codegraph'), result.stdout);
    assert.ok(result.stdout.includes('corrupted'), result.stdout);
    assert.ok(!result.stdout.includes('--profile auto'), result.stdout);
    assert.ok(!result.stdout.includes('--upgrade'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: CTA=needs-graph when graph.json is valid but dep graph absent', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-needsgraph-'));
  try {
    runDist([], target);  // initialize harness (writes graph.json template)
    // Do NOT run --refresh-codegraph, so dep graph is absent
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('--refresh-codegraph'), result.stdout);
    assert.ok(result.stdout.includes('Build the codegraph'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: CTA=needs-refresh when dep graph is malformed JSON', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-stale-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    runDist(['--refresh-codegraph'], target);
    // Corrupt the dep graph to trigger needs-refresh
    fs.writeFileSync(path.join(target, '.ai', 'codegraph', 'dependency-graph.json'), 'not json');
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('--refresh-codegraph'), result.stdout);
    assert.ok(result.stdout.includes('stale or invalid'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('try: CTA=ready when graph.json valid and dep graph fresh (schema-invalid nodes normalized, no crash)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-try-ready-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    runDist(['--refresh-codegraph'], target);
    // Write schema-invalid but parseable graph (null node) — should normalize to ready
    const g = { schema_version: 1, generated_at: '2026-01-01', source: 'test', nodes: [null], edges: [] };
    fs.writeFileSync(path.join(target, '.ai', 'codegraph', 'graph.json'), JSON.stringify(g));
    const result = runDistResult(['try', 'auth'], target);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('--compile-context'), result.stdout);
    assert.ok(!result.stdout.includes('--refresh-codegraph'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── --compile-context: source scope in file-output mode ───────────────────────

test('--compile-context --output: stdout contains "source scope" line', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-scope-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'dep.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(target, 'src', 'entry.ts'), "import { x } from './dep.js';\nexport function read() { return x; }\n");
    runDist(['--refresh-codegraph'], target);
    const outputPath = path.join(target, 'context.json');
    const result = runDistResult(['--compile-context', '--objective', 'change read', '--output', outputPath], target);
    assert.equal(result.exitCode, 0, `compile failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('source scope'), result.stdout);
    assert.ok(result.stdout.includes('indexed source'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--compile-context without --output: stdout is pure JSON, no "source scope"', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-scope-json-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    runDist(['--refresh-codegraph'], target);
    const result = runDistResult(['--compile-context', '--objective', 'login', '--budget', '2000'], target);
    assert.equal(result.exitCode, 0, `compile failed: ${result.stderr}`);
    assert.ok(!result.stdout.includes('source scope'), result.stdout);
    assert.doesNotThrow(() => JSON.parse(result.stdout), 'output must be valid JSON');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── --repair-codegraph E2E ─────────────────────────────────────────────────────

test('--repair-codegraph: malformed → repair → ready (full lifecycle)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-e2e-'));
  try {
    runDist([], target);
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'auth.ts'), 'export function login() {}\n');
    runDist(['--refresh-codegraph'], target);
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    fs.writeFileSync(graphPath, 'not json {{{');
    const repairResult = runDistResult(['--repair-codegraph'], target);
    assert.equal(repairResult.exitCode, 0, `repair failed: ${repairResult.stderr}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(graphPath, 'utf-8')), 'graph.json must be valid JSON after repair');
    const backups = fs.readdirSync(path.join(target, '.ai', 'codegraph')).filter((f) => f.includes('.backup.'));
    assert.ok(backups.length > 0, 'backup must exist');
    const tryResult = runDistResult(['try', 'auth'], target);
    assert.equal(tryResult.exitCode, 0);
    assert.ok(tryResult.stdout.includes('--compile-context'), `expected ready CTA:\n${tryResult.stdout}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--repair-codegraph: backup uniqueness — two repairs create different backup filenames', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-unique-'));
  try {
    runDist([], target);
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    fs.writeFileSync(graphPath, 'bad json 1');
    runDist(['--repair-codegraph'], target);
    fs.writeFileSync(graphPath, 'bad json 2');
    runDist(['--repair-codegraph'], target);
    const backups = fs.readdirSync(path.join(target, '.ai', 'codegraph')).filter((f) => f.includes('.backup.'));
    assert.equal(backups.length, 2, `expected 2 backups, got: ${backups.join(', ')}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--repair-codegraph: valid graph → exit 0, "already valid JSON", graph unchanged', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-valid-'));
  try {
    runDist([], target);
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    const before = fs.readFileSync(graphPath, 'utf-8');
    const result = runDistResult(['--repair-codegraph'], target);
    assert.equal(result.exitCode, 0, `expected exit 0: ${result.stderr}`);
    assert.ok(result.stdout.includes('already valid JSON'), result.stdout);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), before, 'graph content must be unchanged');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--repair-codegraph: no graph.json → exit 1, "nothing to repair", no graph created', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-missing-'));
  try {
    const result = runDistResult(['--repair-codegraph'], target);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('nothing to repair'), result.stderr);
    assert.ok(!fs.existsSync(path.join(target, '.ai', 'codegraph', 'graph.json')), 'no graph must be created');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--repair-codegraph: manifest.json untouched after repair', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-manifest-'));
  try {
    runDist([], target);
    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const beforeManifest = fs.readFileSync(manifestPath, 'utf-8');
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    fs.writeFileSync(graphPath, 'bad json');
    runDist(['--repair-codegraph'], target);
    assert.equal(fs.readFileSync(manifestPath, 'utf-8'), beforeManifest, 'manifest must be unchanged');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('runInit: fresh init writes .ai/codegraph/.gitignore with backup and tmp patterns', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-init-gitignore-'));
  try {
    runDist([], target);
    const gitignorePath = path.join(target, '.ai', 'codegraph', '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.ai/codegraph/.gitignore must be created on fresh init');
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(content.includes('graph.json.backup.*'), content);
    assert.ok(content.includes('graph.json.tmp.*'), content);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade: creates .ai/codegraph/.gitignore even when absent before upgrade', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-gitignore-'));
  try {
    runDist([], target);
    // Remove the file that fresh init just created so --upgrade must recreate it
    fs.rmSync(path.join(target, '.ai', 'codegraph', '.gitignore'), { force: true });
    runDist(['--upgrade'], target);
    const gitignorePath = path.join(target, '.ai', 'codegraph', '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '--upgrade must recreate .ai/codegraph/.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(content.includes('graph.json.backup.*'), content);
    assert.ok(content.includes('graph.json.tmp.*'), content);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── --check-codegraph: null/non-object inputs ──────────────────────────────────

test('--check-codegraph: graph.json = 42 exits non-zero with "must be a JSON object"', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cg-prim-'));
  try {
    runDist([], target);
    fs.writeFileSync(path.join(target, '.ai', 'codegraph', 'graph.json'), '42');
    const result = runDistResult(['--check-codegraph'], target);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stdout.includes('must be a JSON object'), result.stdout);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ── CLI contract ───────────────────────────────────────────────────────────────

test('--help output contains --repair-codegraph', () => {
  const result = runDistResult(['--help'], projectRoot);
  assert.ok(result.stdout.includes('--repair-codegraph'), result.stdout);
});

test('--repair-codegraph --outcome pass → stderr contains override guard error', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-guard-'));
  try {
    const result = runDistResult(['--repair-codegraph', '--outcome', 'pass', '--evaluate'], target);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes('--outcome'), result.stderr);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
