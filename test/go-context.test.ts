import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';
import { generateDependencyGraph, DEPENDENCY_GRAPH_PATH } from '../bin/lib/dependency-graph.js';

function goRepo(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-ctx-'));
  runTs(cli, ['--profile', 'go'], { cwd: target });
  fs.mkdirSync(path.join(target, 'store'), { recursive: true });
  fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
  fs.writeFileSync(path.join(target, 'store', 'service.go'),
    '// ComputeTotal returns the sum of items.\npackage store\n\nfunc ComputeTotal(items []int) int {\n\tsum := 0\n\tfor _, v := range items {\n\t\tsum += v\n\t}\n\treturn sum\n}\n');
  fs.writeFileSync(path.join(target, 'store', 'helper.go'),
    'package store\n\nfunc helperFn() int { return 0 }\n');
  fs.writeFileSync(path.join(target, 'store', 'service_test.go'),
    'package store\n\nfunc TestComputeTotal(t interface{}) {}\n');
  return target;
}

function compile(target: string, args: string[]): { artifact?: CompiledContextArtifact; output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--compile-context', ...args], { cwd: target });
    return { artifact: JSON.parse(output) as CompiledContextArtifact, output, failed: false };
  } catch (error) {
    const e = error as ExecError;
    return { output: `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`, failed: true };
  }
}

function compilePrimary(target: string, taskId: string, objective: string): string {
  const rel = path.join('.ai', 'state', 'context', `${taskId}.json`);
  runTs(cli, ['--compile-context', '--task', taskId, '--objective', objective, '--budget', '8000', '--output', rel], { cwd: target });
  return path.join(target, rel);
}

test('compact mode: full-body Go excerpt with go fence', () => {
  const target = goRepo();
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    runTs(cli, ['--compile-context', '--objective', 'ComputeTotal service', '--mode', 'compact', '--budget', '8000',
      '--output', '.ai/state/context/go.json', '--markdown-output', '.ai/state/context/go.md'], { cwd: target });
    const artifact = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'state', 'context', 'go.json'), 'utf8')) as CompiledContextArtifact;
    const excerpt = artifact.excerpts.find((e) => e.path === 'store/service.go');
    assert.ok(excerpt, 'go excerpt present');
    assert.ok(excerpt!.content.includes('return sum'), 'full body included');
    const md = fs.readFileSync(path.join(target, '.ai', 'state', 'context', 'go.md'), 'utf8');
    assert.match(md, /```go/, 'go fence in markdown');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('baseline mode: whole Go file emitted', () => {
  const target = goRepo();
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const { artifact } = compile(target, ['--objective', 'ComputeTotal service', '--mode', 'baseline', '--budget', '8000']);
    const excerpt = artifact!.excerpts.find((e) => e.path === 'store/service.go')!;
    assert.ok(excerpt, 'go excerpt present in baseline');
    assert.ok(excerpt.content.includes('ComputeTotal'), 'content present');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('expand-context: Go file, test file, and symbol requests all succeed', () => {
  const target = goRepo();
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    // Use an objective unrelated to 'store' so primary artifact does NOT include helper.go/service_test.go,
    // ensuring the expand requests actually trigger expansion (not dedup against primary).
    const artifactPath = compilePrimary(target, 'TASK-20260813-go-expand', 'authentication middleware setup');
    const needPath = path.join(target, '.ai', 'state', 'context', 'need.json');
    fs.writeFileSync(needPath, JSON.stringify({
      kind: 'forgeai_need_context', schema_version: 1, artifact: artifactPath,
      requests: [
        { kind: 'file', path: 'store/helper.go', reason: 'need helper' },
        { kind: 'test', path: 'store/service_test.go', reason: 'need test' },
        { kind: 'symbol', name: 'ComputeTotal', reason: 'need symbol' }
      ]
    }, null, 2) + '\n');
    const out = runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needPath, '--budget', '8000'], { cwd: target });
    const expansion = JSON.parse(out) as CompiledContextArtifact;
    const paths = expansion.excerpts.map((e) => e.path);
    assert.ok(paths.includes('store/helper.go'), 'file request resolved');
    assert.ok(paths.includes('store/service_test.go'), 'test request resolved');
    assert.ok(paths.includes('store/service.go'), 'symbol ComputeTotal resolves to service.go');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('legacy graph lacking node.language still compiles with Go files present', () => {
  const target = goRepo();
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const graph = generateDependencyGraph(target);
    for (const node of graph.nodes) delete (node as Record<string, unknown>).language;
    fs.mkdirSync(path.join(target, '.ai', 'codegraph'), { recursive: true });
    fs.writeFileSync(path.join(target, DEPENDENCY_GRAPH_PATH), JSON.stringify(graph, null, 2) + '\n');
    const { artifact, failed, output } = compile(target, ['--objective', 'ComputeTotal service', '--budget', '8000']);
    assert.ok(!failed, `compile failed: ${output}`);
    assert.ok(artifact, 'compiled without error despite missing language');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});
