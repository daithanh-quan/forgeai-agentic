import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireSessionLock,
  heartbeatSessionLock,
  inspectSessionLocks,
  recoverStaleSessionLocks,
  releaseSessionLock,
  withSessionLock,
} from '../bin/lib/sessions.js';
import { cli, type ExecError, projectRoot, runTs } from './helpers.js';

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

test('Phase 17: atomic lock acquisition, prefix overlap conflict, heartbeat, and ownership-checked release', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-locks-lifecycle-'));
  try {
    runTs(cli, [], { cwd: target });

    const first = acquireSessionLock(
      {
        sessionId: 'api-worker',
        owner: 'codex',
        branch: 'feat/api-v2',
        writeScope: ['./src/api/'],
        readScope: ['src/shared/'],
        ttlSeconds: 120,
        nowMs: 1_700_000_000_000
      },
      target
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.lock.write_scope, ['src/api']);
    assert.equal(first.lock.owner, 'codex');

    // Disjoint lock succeeds
    const disjoint = acquireSessionLock(
      {
        sessionId: 'ui-worker',
        owner: 'claude',
        branch: 'feat/ui-v2',
        writeScope: ['src/ui/Button.tsx'],
        ttlSeconds: 120,
        nowMs: 1_700_000_000_000
      },
      target
    );
    assert.equal(disjoint.ok, true);

    // Overlapping file inside locked prefix fails with worktree-aware conflict
    const overlap = acquireSessionLock(
      {
        sessionId: 'api-subworker',
        owner: 'claude',
        branch: 'feat/api-routes',
        writeScope: ['src/api/routes.ts'],
        ttlSeconds: 120,
        nowMs: 1_700_000_010_000
      },
      target
    );
    assert.equal(overlap.ok, false);
    if (overlap.ok) return;
    assert.equal(overlap.reason, 'conflict');
    assert.equal(overlap.conflicts.length, 1);
    assert.equal(overlap.conflicts[0].holder_id, 'api-worker');
    assert.equal(overlap.conflicts[0].conflicting_scope, 'src/api');
    assert.match(overlap.detail, /scope 'src\/api\/routes\.ts' conflicts with active lock 'api-worker' on 'src\/api'/);
    assert.match(overlap.detail, /owner: codex, branch: feat\/api-v2, worktree: .* \[current worktree\]/);

    // Heartbeat rejects wrong owner and extends expiry for rightful owner
    const wrongOwnerHb = heartbeatSessionLock(
      { sessionId: 'api-worker', owner: 'claude', nowMs: 1_700_000_030_000 },
      target
    );
    assert.equal(wrongOwnerHb.ok, false);
    if (!wrongOwnerHb.ok) assert.equal(wrongOwnerHb.reason, 'owner_mismatch');

    const validHb = heartbeatSessionLock(
      { sessionId: 'api-worker', owner: 'codex', ttlSeconds: 300, nowMs: 1_700_000_030_000 },
      target
    );
    assert.equal(validHb.ok, true);
    if (validHb.ok) {
      assert.equal(validHb.lock.expires_at, new Date(1_700_000_030_000 + 300_000).toISOString());
    }

    // Release rejects wrong owner without --force, succeeds for rightful owner
    const wrongUnlock = releaseSessionLock(
      { sessionId: 'api-worker', owner: 'claude', nowMs: 1_700_000_040_000 },
      target
    );
    assert.equal(wrongUnlock.ok, false);
    if (!wrongUnlock.ok) assert.equal(wrongUnlock.reason, 'owner_mismatch');

    const rightUnlock = releaseSessionLock(
      { sessionId: 'api-worker', owner: 'codex', nowMs: 1_700_000_040_000 },
      target
    );
    assert.equal(rightUnlock.ok, true);

    // After release, api-subworker can acquire src/api/routes.ts
    const afterRelease = acquireSessionLock(
      {
        sessionId: 'api-subworker',
        owner: 'claude',
        writeScope: ['src/api/routes.ts'],
        nowMs: 1_700_000_050_000
      },
      target
    );
    assert.equal(afterRelease.ok, true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('Phase 17: stale-lock detection and recovery for expired TTL and dead PID (read-only --check-sessions vs --recover-stale)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-locks-stale-'));
  try {
    runTs(cli, [], { cwd: target });

    // Create a lock with short TTL that is already expired relative to future nowMs,
    // and another lock with a dead PID.
    const pastNow = Date.now() - 60_000;
    const expiredRes = acquireSessionLock(
      {
        sessionId: 'expired-worker',
        owner: 'codex',
        writeScope: ['src/expired.ts'],
        ttlSeconds: 10,
        nowMs: pastNow
      },
      target
    );
    assert.equal(expiredRes.ok, true);

    const deadPidRes = acquireSessionLock(
      {
        sessionId: 'crashed-worker',
        owner: 'claude',
        writeScope: ['src/crashed.ts'],
        ttlSeconds: 1800,
        pid: 999_999_991
      },
      target
    );
    assert.equal(deadPidRes.ok, true);

    // Bare --check-sessions is read-only: reports stale locks, exits 1, and leaves files on disk
    assert.throws(
      () => runTs(cli, ['--check-sessions'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /stale\s+crashed-worker \(dead pid 999999991\)/);
        assert.match(stdout, /stale\s+expired-worker \(expired at /);
        assert.match(stdout, /recover\s+run forgeai-init --check-sessions --recover-stale/);
        return true;
      }
    );
    assert.equal(inspectSessionLocks(target).stale.length, 2, 'read-only --check-sessions must not delete stale locks');

    // Acquiring an overlapping scope automatically reclaims the stale lock for that scope
    const reclaimOne = acquireSessionLock(
      {
        sessionId: 'fresh-worker',
        owner: 'agy',
        writeScope: ['src/expired.ts']
      },
      target
    );
    assert.equal(reclaimOne.ok, true);
    assert.equal(reclaimOne.recovered_stale_locks.length, 1);
    assert.equal(reclaimOne.recovered_stale_locks[0].lock.session_id, 'expired-worker');

    // --check-sessions --recover-stale removes the remaining stale lock and exits 0
    const recoverOut = runTs(cli, ['--check-sessions', '--recover-stale'], { cwd: target });
    assert.match(recoverOut, /recovered\s+crashed-worker stale lock removed \(dead pid 999999991\)/);
    assert.match(recoverOut, /locked\s+fresh-worker active write: src\/expired\.ts/);
    assert.match(recoverOut, /Result: active sessions have disjoint write scopes\./);
    assert.equal(inspectSessionLocks(target).stale.length, 0);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('Phase 17: CLI --lock-session, --heartbeat-session, --unlock-session, and --check-sessions --json', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-locks-cli-'));
  try {
    runTs(cli, [], { cwd: target });

    const lockOut = runTs(
      cli,
      ['--lock-session', '--session', 'cli-s1', '--owner', 'codex', '--write-scope', 'src/core,src/utils.ts', '--ttl', '60', '--json'],
      { cwd: target }
    );
    const lockJson = JSON.parse(lockOut) as { ok: boolean; lock: { session_id: string; write_scope: string[] } };
    assert.equal(lockJson.ok, true);
    assert.deepEqual(lockJson.lock.write_scope, ['src/core', 'src/utils.ts']);

    // Conflicting CLI lock exits 1 with conflict details
    assert.throws(
      () =>
        runTs(
          cli,
          ['--lock-session', '--session', 'cli-s2', '--owner', 'claude', '--write-scope', 'src/core/index.ts'],
          { cwd: target }
        ),
      (error: unknown) => {
        const stderr = String((error as ExecError).stderr ?? '');
        assert.match(stderr, /conflicts with active lock 'cli-s1' on 'src\/core'/);
        return true;
      }
    );

    const hbOut = runTs(cli, ['--heartbeat-session', '--session', 'cli-s1', '--owner', 'codex', '--ttl', '120'], { cwd: target });
    assert.match(hbOut, /heartbeat\s+cli-s1 extended until /);

    const checkJsonOut = runTs(cli, ['--check-sessions', '--json'], { cwd: target });
    const checkReport = JSON.parse(checkJsonOut) as { ok: boolean; active_locks: Array<{ session_id: string }> };
    assert.equal(checkReport.ok, true);
    assert.equal(checkReport.active_locks.length, 1);
    assert.equal(checkReport.active_locks[0].session_id, 'cli-s1');

    const unlockOut = runTs(cli, ['--unlock-session', '--session', 'cli-s1', '--owner', 'codex'], { cwd: target });
    assert.match(unlockOut, /unlocked\s+cli-s1 released/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('Phase 17: cross-worktree conflict detection reports linked git worktree and branch', () => {
  const mainRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-wt-main-'));
  const linkedRepo = path.join(os.tmpdir(), `forgeai-wt-linked-${process.pid}-${Date.now()}`);
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: mainRepo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRepo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: mainRepo });
    fs.writeFileSync(path.join(mainRepo, 'README.md'), '# repo\n');
    execFileSync('git', ['add', 'README.md'], { cwd: mainRepo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: mainRepo });
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/wt-b', linkedRepo, 'main'], { cwd: mainRepo });

    runTs(cli, ['--lock-session', '--session', 'wt-main-lock', '--owner', 'codex', '--write-scope', 'src/payments'], { cwd: mainRepo });

    // Acquiring overlapping scope from linked worktree detects lock in main worktree
    assert.throws(
      () =>
        runTs(
          cli,
          ['--lock-session', '--session', 'wt-linked-lock', '--owner', 'claude', '--write-scope', 'src/payments/charge.ts'],
          { cwd: linkedRepo }
        ),
      (error: unknown) => {
        const stderr = String((error as ExecError).stderr ?? '');
        assert.match(stderr, /conflicts with active lock 'wt-main-lock' on 'src\/payments'/);
        assert.match(stderr, /\[linked worktree\]/);
        return true;
      }
    );
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', linkedRepo], { cwd: mainRepo }); } catch { /* ignore */ }
    fs.rmSync(linkedRepo, { recursive: true, force: true });
    fs.rmSync(mainRepo, { recursive: true, force: true });
  }
});

test('Phase 17: withSessionLock crash-safe release and task lock enforcement without treating lock files as source changes', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-lock-'));
  try {
    // 1. withSessionLock releases lock even when callback throws
    await assert.rejects(
      () =>
        withSessionLock(
          { sessionId: 'throwing-session', owner: 'codex', writeScope: ['src/input.ts'] },
          () => {
            assert.equal(inspectSessionLocks(target).active.length, 1);
            throw new Error('simulated failure');
          },
          target
        ),
      /simulated failure/
    );
    assert.equal(inspectSessionLocks(target).active.length, 0, 'lock must be released after failure');

    // 2. Task execution refuses to run adapter when an active lock conflicts with write scope
    fs.mkdirSync(path.join(target, '.ai'), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, 'templates', '.ai', 'RULES.md'), path.join(target, '.ai', 'RULES.md'));
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'input.ts'), 'export const input = true;\n');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    fs.writeFileSync(
      path.join(target, '.ai', 'cli-adapters.json'),
      JSON.stringify({
        version: 1,
        adapters: {
          fixture: {
            command: process.execPath,
            args: ['-e', "require('fs').appendFileSync('src/input.ts', 'export const changed = 1;\\n')"],
            input: 'stdin'
          }
        }
      })
    );
    execFileSync('git', ['init', '-q'], { cwd: target });

    acquireSessionLock(
      { sessionId: 'blocking-session', owner: 'other-agent', writeScope: ['src/input.ts'] },
      target
    );

    assert.throws(
      () => runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'update input'], { cwd: target }),
      (error: unknown) => {
        const execErr = error as ExecError;
        const stderr = String(execErr.stderr ?? '');
        assert.match(stderr, /write scope lock conflict/);
        assert.match(stderr, /blocking-session/);
        return true;
      }
    );
    assert.equal(fs.readFileSync(path.join(target, 'src', 'input.ts'), 'utf8'), 'export const input = true;\n');

    // Release blocking lock, leave a non-overlapping lock on src/other.ts, and verify task succeeds
    // without treating .ai/state/locks/other-session.json as an out-of-scope source change.
    releaseSessionLock({ sessionId: 'blocking-session' }, target);
    acquireSessionLock(
      { sessionId: 'other-session', owner: 'other-agent', writeScope: ['docs/guide.md'] },
      target
    );

    const taskOut = runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'update input'], { cwd: target });
    const report = JSON.parse(taskOut) as { status: string; changed_files: string[]; out_of_scope_files: string[] };
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.changed_files, ['src/input.ts']);
    assert.deepEqual(report.out_of_scope_files, []);
    // Task's own lock was released on completion, leaving only other-session
    const remainingLocks = inspectSessionLocks(target).active.map((a) => a.lock.session_id);
    assert.deepEqual(remainingLocks, ['other-session']);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('Phase 17: recoverStaleSessionLocks API cleans only stale locks and preserves active ones', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-recover-api-'));
  try {
    const baseMs = 1_700_000_000_000;
    acquireSessionLock({ sessionId: 'stale-1', writeScope: ['src/a.ts'], ttlSeconds: 10, nowMs: baseMs }, target);
    acquireSessionLock({ sessionId: 'active-1', writeScope: ['src/b.ts'], ttlSeconds: 600, nowMs: baseMs }, target);

    const recovered = recoverStaleSessionLocks(target, { nowMs: baseMs + 30_000 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].lock.session_id, 'stale-1');

    const after = inspectSessionLocks(target, { nowMs: baseMs + 30_000 });
    assert.equal(after.stale.length, 0);
    assert.equal(after.active.length, 1);
    assert.equal(after.active[0].lock.session_id, 'active-1');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
