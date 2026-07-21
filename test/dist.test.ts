import assert from 'node:assert/strict';
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
