import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, runTs } from './helpers.js';
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';
import { handleMcpRequest } from '../bin/lib/mcp.js';
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

test('context --copy writes compiled context to clipboard without creating repository files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-copy-'));
  const clipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-clip-target-'));
  try {
    const source = 'export function verifySessionToken(token: string) { return token.length > 10; }\n';
    fs.writeFileSync(path.join(cwd, 'session.ts'), source);
    const clipFile = path.join(clipDir, 'clipboard.txt');
    const stdout = runTs(cli, ['context', 'verifySessionToken', '--copy'], {
      cwd,
      env: { ...process.env, FORGEAI_CLIPBOARD_FILE: clipFile }
    });
    assert.equal(stdout, '');
    assert.match(fs.readFileSync(clipFile, 'utf8'), /verifySessionToken/);
    assert.deepEqual(fs.readdirSync(cwd), ['session.ts']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(clipDir, { recursive: true, force: true });
  }
});

test('context falls back to camelCase/snake_case declaration word-stem seed matching and traverses @/ aliases', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-alias-seed-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'src', 'lib', 'tax.ts'),
      'export function computeVatRate() { return 0.1; }\n'
    );
    fs.writeFileSync(
      path.join(cwd, 'src', 'service.ts'),
      "import { computeVatRate } from '@/lib/tax';\nexport class BillingEngine {\n  calculateProratedInvoice(amount: number) { return amount * (1 + computeVatRate()); }\n}\n"
    );
    const output = runTs(cli, ['context', 'fix prorated invoice', '--json'], { cwd });
    const artifact = JSON.parse(output) as CompiledContextArtifact;
    const selectedPaths = artifact.selection.files.map((f) => f.path);
    assert.ok(selectedPaths.includes('src/service.ts'), 'seed must match camelCase method inside class');
    assert.ok(selectedPaths.includes('src/lib/tax.ts'), 'dependency via @/lib/tax alias must be traversed');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('MCP server handles initialize, tools/list, and tools/call for context, try, quality, and diagnostics', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mcp-test-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'src', 'auth.ts'),
      'export function validateLoginRedirect(url: string) { return url.startsWith("/"); }\n'
    );

    const initRes = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, cwd) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    assert.equal(initRes.result.protocolVersion, '2024-11-05');
    assert.equal(initRes.result.serverInfo.name, 'forgeai-agentic-init');

    assert.equal(handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, cwd), null);

    const listRes = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, cwd) as {
      result: { tools: Array<{ name: string }> };
    };
    assert.deepEqual(
      listRes.result.tools.map((t) => t.name),
      ['forgeai_context', 'forgeai_try', 'forgeai_check_quality', 'forgeai_diagnostics', 'forgeai_code']
    );

    const ctxRes = handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'forgeai_context', arguments: { objective: 'validateLoginRedirect' } } },
      cwd
    ) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(ctxRes.result.isError, false);
    assert.match(ctxRes.result.content[0].text, /validateLoginRedirect/);

    const tryRes = handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'forgeai_try', arguments: { objective: 'validateLoginRedirect' } } },
      cwd
    ) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(tryRes.result.isError, false);
    assert.match(tryRes.result.content[0].text, /src\/auth\.ts/);

    const qualRes = handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'forgeai_check_quality', arguments: { strict: true } } },
      cwd
    ) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(qualRes.result.isError, false);
    const qualReport = JSON.parse(qualRes.result.content[0].text) as { passed: boolean; functions_analyzed: number };
    assert.equal(qualReport.passed, true);
    assert.equal(qualReport.functions_analyzed, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
