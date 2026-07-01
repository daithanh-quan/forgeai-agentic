import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

const ENV = { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initProject(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-review-'));
  runTs(cli, [], { cwd: target, env: ENV });
  return target;
}

function writeJournal(
  target: string,
  opts: { id?: string; state?: string; evidence?: string; finding?: string } = {}
): void {
  const id = opts.id ?? 'TASK-20260701-profile-edit';
  const state = opts.state ?? 'review';
  const evidence = opts.evidence ?? `| ${today()} | \`npm test -- profile\` | pass | 8 unit tests |`;
  const finding = opts.finding ?? `| ${today()} | Codex | Approve | none | resolved |`;
  const content = [
    '# Task Journal',
    '',
    '## Identity',
    '',
    `- Task ID: \`${id}\``,
    '- Task type: `feature`',
    `- Current state: \`${state}\``,
    `- Last updated: \`${today()}\``,
    '- Stale status: `fresh`',
    '',
    '## Commands And Validation',
    '',
    '| Date | Command/check | Result | Notes |',
    '| --- | --- | --- | --- |',
    evidence,
    '',
    '## Review Findings',
    '',
    '| Date | Reviewer | Status | Findings | Resolution |',
    '| --- | --- | --- | --- | --- |',
    finding,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(target, '.ai', 'state', 'tasks', `${id}.md`), content);
}

function writeScorecard(target: string, opts: { id?: string; verdict?: string; blockers?: string } = {}): void {
  const id = opts.id ?? 'TASK-20260701-profile-edit';
  const verdict = opts.verdict ?? 'Approve';
  const blockers = opts.blockers ?? 'none';
  const content = [
    `# Review Scorecard - ${id}`,
    '',
    `- Task ID: \`${id}\``,
    '- Reviewer: `Codex`',
    `- Date: \`${today()}\``,
    '',
    '## Scorecard',
    '',
    '| Dimension | Rating | Notes |',
    '| --- | --- | --- |',
    '| Correctness | pass | happy path tested |',
    '| Scope control | pass | profile only |',
    '| Security | pass | - |',
    '| Tests/validation | pass | unit + manual QA |',
    '| Maintainability | pass | - |',
    '| Release risk | pass | - |',
    '',
    `Unresolved blockers: ${blockers}`,
    '',
    `Verdict: ${verdict}`,
    ''
  ].join('\n');
  fs.mkdirSync(path.join(target, '.ai', 'state', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(target, '.ai', 'state', 'reviews', `${id}.md`), content);
}

test('review gate passes when no journals are in a gated state', () => {
  const target = initProject();
  try {
    const output = runTs(cli, ['--check-review'], { cwd: target, env: ENV });
    assert.match(output, /no task journals awaiting the review gate/);
    assert.match(output, /Result: review gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate passes for a complete gated journal + scorecard', () => {
  const target = initProject();
  try {
    writeJournal(target);
    writeScorecard(target);
    const output = runTs(cli, ['--check-review'], { cwd: target, env: ENV });
    assert.match(output, /passes the review gate/);
    assert.match(output, /Result: review gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when validation evidence is missing', () => {
  const target = initProject();
  try {
    writeJournal(target, { evidence: '| YYYY-MM-DD | ... | pass | ... |' });
    writeScorecard(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /no real validation evidence/);
        assert.match(String(error.stdout), /Result: review gate failed\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when the scorecard is missing', () => {
  const target = initProject();
  try {
    writeJournal(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /scorecard for/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when the scorecard still has TODO', () => {
  const target = initProject();
  try {
    writeJournal(target);
    const id = 'TASK-20260701-profile-edit';
    fs.mkdirSync(path.join(target, '.ai', 'state', 'reviews'), { recursive: true });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'reviews', `${id}.md`),
      ['# Scorecard', '', 'Unresolved blockers: none', '', 'Verdict: TODO'].join('\n')
    );
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /still contains TODO/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when Approve verdict has unresolved blockers', () => {
  const target = initProject();
  try {
    writeJournal(target);
    writeScorecard(target, { verdict: 'Approve', blockers: 'missing rate limit' });
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /unresolved blockers/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when there is no valid recommendation', () => {
  const target = initProject();
  try {
    writeJournal(target, { finding: '| YYYY-MM-DD | ... | `Approve | Request changes` | ... | ... |' });
    writeScorecard(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /no review finding with a recommendation/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all includes the review gate section', () => {
  const target = initProject();
  try {
    let output = '';
    try {
      output = runTs(cli, ['--check-all'], { cwd: target, env: ENV });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /ForgeAI review gate check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade preserves a real scorecard but refreshes the template', () => {
  const target = initProject();
  try {
    const id = 'TASK-20260701-profile-edit';
    const reviewsDir = path.join(target, '.ai', 'state', 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewsDir, `${id}.md`), 'CUSTOM SCORECARD CONTENT\n');

    runTs(cli, ['--upgrade'], { cwd: target, env: ENV });

    assert.equal(fs.readFileSync(path.join(reviewsDir, `${id}.md`), 'utf8'), 'CUSTOM SCORECARD CONTENT\n');
    assert.equal(fs.existsSync(path.join(reviewsDir, '_template.md')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
