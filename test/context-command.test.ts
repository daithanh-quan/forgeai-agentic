import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, runTs } from './helpers.js';

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
