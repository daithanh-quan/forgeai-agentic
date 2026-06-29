import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

test('session check allows disjoint active write scopes', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-sessions-clean-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'sessions.md'),
      [
        '# Agent Sessions',
        '',
        '## Active Sessions',
        '',
        '| ID | Owner | Task | Branch | Status | Started | Read scope | Write scope | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| ui-task | Codex | UI | feat/ui | active | 2026-06-25 | `src/ui/` | `src/ui/Button.tsx` | |',
        '| api-task | Claude | API | feat/api | active | 2026-06-25 | `src/api/` | `src/api/routes.ts` | |'
      ].join('\n')
    );

    const output = runTs(cli, ['--check-sessions'], { cwd: target });

    assert.match(output, /ForgeAI session check/);
    assert.match(output, /active\s+ui-task active write: src\/ui\/Button\.tsx/);
    assert.match(output, /Result: active sessions have disjoint write scopes\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('session check rejects overlapping active write scopes', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-sessions-overlap-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'sessions.md'),
      [
        '# Agent Sessions',
        '',
        '## Active Sessions',
        '',
        '| ID | Owner | Task | Branch | Status | Started | Read scope | Write scope | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| backend-a | Codex | API | feat/api-a | active | 2026-06-25 | `src/api/` | `src/api/` | |',
        '| backend-b | Claude | API tests | feat/api-b | active | 2026-06-25 | `src/api/` | `src/api/routes.ts` | |'
      ].join('\n')
    );

    assert.throws(
      () => runTs(cli, ['--check-sessions'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /overlap\s+backend-a \(src\/api\) conflicts with backend-b \(src\/api\/routes\.ts\)/);
        assert.match(stdout, /Result: active sessions need coordination before parallel agent work continues\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('session check parses write scopes correctly despite escaped pipes', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-session-escape-'));

  try {
    runTs(cli, [], { cwd: target });

    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'sessions.md'),
      [
        '# Agent Sessions',
        '',
        '## Active Sessions',
        '',
        '| ID | Owner | Task | Branch | Status | Started | Read scope | Write scope | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| s1 | alice | refactor | feat/x | active | 2026-06-01 | - | src/app | - |',
        '| s2 | bob | fix a \\| b | feat/y | active | 2026-06-02 | - | src/app | - |',
        ''
      ].join('\n')
    );

    assert.throws(
      () => runTs(cli, ['--check-sessions'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /overlap/);
        assert.match(stdout, /Result: active sessions need coordination/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
