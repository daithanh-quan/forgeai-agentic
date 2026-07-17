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
