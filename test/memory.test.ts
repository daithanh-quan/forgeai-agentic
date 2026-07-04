import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

// Writes a .ai/MEMORY.md fixture without running a full init.
export function writeMemory(target: string, content: string): void {
  fs.mkdirSync(path.join(target, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(target, '.ai', 'MEMORY.md'), content);
}

export function runCheckMemoryCli(target: string): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--check-memory'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? ''), failed: true };
  }
}

test('check-memory passes on a minimal populated memory file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-ok-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Commands\n\n- Build: run the standard build.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /ForgeAI memory check/);
    assert.match(output, /ok\s+no stale-memory signals detected/);
    assert.match(output, /Result: memory check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory fails when .ai/MEMORY.md is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-missing-'));

  try {
    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, true);
    assert.match(output, /fail\s+\.ai\/MEMORY\.md not found/);
    assert.match(output, /Result: memory check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory fails on a dead path reference', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-deadpath-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Coding conventions\n\n- API clients live in `src/api/client.ts`.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, true);
    assert.match(output, /fail\s+\.ai\/MEMORY\.md:5: references missing path `src\/api\/client\.ts`/);
    assert.match(output, /Result: memory check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory accepts existing paths and skips non-path tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-livepath-'));

  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'index.ts'), 'export {};\n');
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Coding conventions',
        '',
        '- Entry point is `src/index.ts:1`.',
        '- Feature APIs follow `src/features/*/*Api.ts`.',
        '- Placeholders like `<service-name>` and `TODO.md` patterns are skipped.',
        '- Packages like `@types/node` and URLs like `https://example.com/a.ts` are skipped.',
        '- Commands like `npm run build` are skipped.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.doesNotMatch(output, /references missing path/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns on TODO placeholders without failing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-todo-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Business rules\n\n- TODO: Rule that must not be broken.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: unfilled TODO placeholder/);
    assert.match(output, /Result: memory check passed with warnings\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns on entries older than the age threshold', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-stale-'));

  try {
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 — Ancient decision',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: entry dated 2020-01-01 is older than 180 days/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory respects the max-age-days directive', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-directive-'));

  try {
    writeMemory(
      target,
      [
        '<!-- forgeai-memory: max-age-days=100000 -->',
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 — Ancient but accepted',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.doesNotMatch(output, /is older than/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns and falls back on an invalid directive value', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-badvalue-'));

  try {
    writeMemory(
      target,
      '<!-- forgeai-memory: max-age-days=soon -->\n# Project Memory\n\n## Commands\n\n- Build: standard.\n'
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md: invalid forgeai-memory max-age-days value "soon"; using default 180/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory treats hyphen-separated dated headings as stale too', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-hyphen-'));

  try {
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 - Ancient decision with hyphen',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: entry dated 2020-01-01 is older than 180 days/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns on malformed decision entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-malformed-'));

  try {
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### We picked a database',
        '',
        '- We use SQLite.',
        '',
        '### 2026-07-01 — Missing fields',
        '',
        '- **Decision:** Use SQLite.',
        '',
        '## Commands',
        '',
        '### No date needed here',
        '',
        '- Build: standard.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: decision heading does not match "### YYYY-MM-DD — Title"/);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:9: decision entry is missing \*\*Why:\*\*/);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:9: decision entry is missing \*\*Impact:\*\*/);
    assert.doesNotMatch(output, /:15:/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('freshly initialized template passes check-memory with only warns', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-fresh-'));

  try {
    runTs(cli, [], { cwd: target, env: { ...process.env, PATH: '' } });

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /unfilled TODO placeholder/);
    assert.match(output, /Result: memory check passed with warnings\./);

    const template = fs.readFileSync(path.join(target, '.ai', 'MEMORY.md'), 'utf8');
    assert.match(template, /<!-- forgeai-memory: max-age-days=180 -->/);
    assert.match(template, /## Recurring bugs & pitfalls/);
    assert.match(template, /## Commands/);
    assert.match(template, /## Test strategy/);
    assert.match(template, /## Ownership/);
    assert.match(template, /## Deployment notes/);
    assert.doesNotMatch(template, /Jira|Trello|External integrations/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory accepts .ai-relative path references (upgrade regression guard)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-airel-'));

  try {
    fs.mkdirSync(path.join(target, '.ai', 'state'), { recursive: true });
    fs.writeFileSync(path.join(target, '.ai', 'state', 'CURRENT.md'), '# stub\n');
    writeMemory(target, '# Project Memory\n\n## Commands\n\n- Use `state/CURRENT.md` for temporary notes.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.doesNotMatch(output, /references missing path/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory treats unterminated directive as absent (uses default 180-day threshold)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-unterminated-'));

  try {
    writeMemory(
      target,
      [
        '<!-- forgeai-memory: max-age-days=100000',
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 — Old',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /is older than/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory completes quickly on a large unterminated directive (ReDoS guard)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-redos-'));

  try {
    const content = '<!-- forgeai-memory:' + ' '.repeat(50000) + '\n# Project Memory\n';
    writeMemory(target, content);

    const start = Date.now();
    runCheckMemoryCli(target);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 5000, `check-memory took ${elapsed}ms on unterminated directive — ReDoS suspected`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all includes the memory check', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-checkall-'));

  try {
    runTs(cli, [], { cwd: target, env: { ...process.env, PATH: '' } });

    let output = '';
    try {
      output = runTs(cli, ['--check-all'], { cwd: target, env: { ...process.env, PATH: '' } });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /ForgeAI memory check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
