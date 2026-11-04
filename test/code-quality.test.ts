import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  analyzeFilesQuality,
  computeCrapScore,
  computeCyclomaticComplexity,
  computeStructuralSimilarity
} from '../bin/lib/code-quality.js';
import { hasRepeatedGateFailure } from '../bin/lib/review.js';
import { cli, type ExecError, projectRoot, runTs } from './helpers.js';

test('ub-mode principles are integrated into harness rules, skills, and quality gates', () => {
  const rules = fs.readFileSync(path.join(projectRoot, 'templates/.ai/RULES.md'), 'utf8');
  const taste = fs.readFileSync(path.join(projectRoot, 'templates/.ai/TASTE.md'), 'utf8');
  const testingSkill = fs.readFileSync(path.join(projectRoot, 'templates/.ai/skills/testing/SKILL.md'), 'utf8');
  const reviewSkill = fs.readFileSync(path.join(projectRoot, 'templates/.ai/skills/code-review/SKILL.md'), 'utf8');
  const qualityGates = fs.readFileSync(path.join(projectRoot, 'templates/.ai/workflows/quality-gates.md'), 'utf8');

  // RULES.md: Laziness protocol, subtract before add, boundary/type discipline, root cause, idempotency
  assert.match(rules, /illegal states/i);
  assert.match(rules, /One decision lives in one place/i);
  assert.match(rules, /Subtract complexity/i);
  assert.match(rules, /idempotent/i);
  assert.match(rules, /root cause/i);

  // TASTE.md: First Make it Work, Then Make it Right
  assert.match(taste, /First Make it Work/i);
  assert.match(taste, /Then Make it Right/i);

  // testing/SKILL.md: TDD (failing test first) & Test behavior, not implementation
  assert.match(testingSkill, /Write the failing test before/i);
  assert.match(testingSkill, /Test behavior, not implementation/i);
  assert.match(testingSkill, /returned nothing/i);

  // code-review/SKILL.md: Root cause & behavioral test checks
  assert.match(reviewSkill, /root cause/i);
  assert.match(reviewSkill, /observable behavior/i);

  // quality-gates.md: Attack the Premise escalation rule
  assert.match(qualityGates, /Attack the Premise/i);
});

test('Attack the Premise requires adjacent failures of the same validation command', () => {
  assert.equal(hasRepeatedGateFailure([
    ['2026-11-04', 'npm test', 'fail'],
    ['2026-11-04', 'npm test', 'fail']
  ], []), true);
  assert.equal(hasRepeatedGateFailure([
    ['2026-11-04', 'npm test', 'fail'],
    ['2026-11-04', 'npm run lint', 'pass'],
    ['2026-11-04', 'npm test', 'fail']
  ], []), false);
  assert.equal(hasRepeatedGateFailure([
    ['2026-11-04', 'npm test', 'fail'],
    ['2026-11-04', 'npm run lint', 'fail'],
    ['2026-11-04', 'npm test', 'fail']
  ], []), false);
  assert.equal(hasRepeatedGateFailure([], [
    ['2026-11-04', 'reviewer', 'request changes'],
    ['2026-11-04', 'reviewer', 'approve'],
    ['2026-11-04', 'reviewer', 'request changes']
  ]), false);
});

test('computeCyclomaticComplexity counts decision points and ignores strings and comments', () => {
  const simple = 'export function add(a: number, b: number) { return a + b; }';
  assert.equal(computeCyclomaticComplexity(simple), 1);

  const withStringsAndComments = `
    export function greet(name: string) {
      // if (a && b || c) while (true) for (;;) case 1: catch {}
      const msg = "if (x && y || z) ? a : b";
      return msg + name;
    }
  `;
  assert.equal(computeCyclomaticComplexity(withStringsAndComments), 1);

  const complexFn = `
    export function evaluateItem(x: number, y: number, flag: boolean) {
      if (x > 0 && y > 0) {
        for (let i = 0; i < x; i++) {
          if (i % 2 === 0 || flag) {
            while (y > 10) {
              y--;
            }
          }
        }
      } else if (x < 0 ?? false) {
        switch (y) {
          case 1:
            return 1;
          case 2:
            return flag ? 2 : 3;
          default:
            break;
        }
      }
      try {
        return x + y;
      } catch (err) {
        return 0;
      }
    }
  `;
  assert.ok(computeCyclomaticComplexity(complexFn) >= 10);
});

test('computeCrapScore follows the CRAP formula', () => {
  // CRAP(m) = comp^2 * (1 - cov)^3 + comp
  assert.equal(computeCrapScore(1, 1), 1);
  assert.equal(computeCrapScore(1, 0), 2);
  assert.equal(computeCrapScore(3, 0), 12);
  assert.equal(computeCrapScore(10, 1), 10);
});

test('computeStructuralSimilarity detects Type-2 cloned functions and ignores distinct logic', () => {
  const fnA = `
    export function normalizeOrderItems(items: Array<{ price: number; qty: number; active: boolean }>) {
      const results: number[] = [];
      for (const item of items) {
        if (!item.active || item.qty <= 0) continue;
        const subtotal = item.price * item.qty;
        if (subtotal > 100) {
          results.push(subtotal * 0.9);
        } else {
          results.push(subtotal);
        }
      }
      return results.reduce((sum, val) => sum + val, 0);
    }
  `;
  const fnB = `
    export function calculateInvoiceLines(lines: Array<{ cost: number; count: number; enabled: boolean }>) {
      const totals: number[] = [];
      for (const line of lines) {
        if (!line.enabled || line.count <= 0) continue;
        const amount = line.cost * line.count;
        if (amount > 100) {
          totals.push(amount * 0.9);
        } else {
          totals.push(amount);
        }
      }
      return totals.reduce((acc, current) => acc + current, 0);
    }
  `;
  const distinctFn = `
    export function formatUserSummary(id: string, roles: Set<string>, MapLookup: Map<string, string>) {
      const label = MapLookup.get(id) ?? 'unknown';
      switch (roles.size) {
        case 0:
          return \`guest:\${label}\`;
        case 1:
          return \`member:\${label}\`;
        default:
          return \`admin:\${label}:\${roles.size}\`;
      }
    }
  `;

  assert.ok(computeStructuralSimilarity(fnA, fnB) >= 0.8);
  assert.ok(computeStructuralSimilarity(fnA, distinctFn) < 0.5);
});

test('analyzeFilesQuality flags functions with complexity >= 10 and duplication >= 0.8', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-quality-unit-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'src/service.ts'),
      `
export function overlyComplex(a: number, b: number, c: number, d: boolean, e: boolean) {
  if (a > 1 && b > 1) {
    if (c > 1 || d) {
      for (let i = 0; i < a; i++) {
        while (b > 0 && e) {
          if (i === b) return 1;
          b--;
        }
      }
    } else if (a < 0 || c < 0) {
      return d ? 2 : 3;
    }
  }
  return 0;
}

export function processAlphaRecords(records: Array<{ value: number; valid: boolean; weight: number }>) {
  const out: number[] = [];
  for (const rec of records) {
    if (!rec.valid || rec.weight <= 0) continue;
    const score = rec.value * rec.weight;
    if (score > 50) {
      out.push(score - 5);
    } else {
      out.push(score);
    }
  }
  return out.reduce((a, b) => a + b, 0);
}

export function processBetaRecords(entries: Array<{ amount: number; active: boolean; factor: number }>) {
  const list: number[] = [];
  for (const entry of entries) {
    if (!entry.active || entry.factor <= 0) continue;
    const total = entry.amount * entry.factor;
    if (total > 50) {
      list.push(total - 5);
    } else {
      list.push(total);
    }
  }
  return list.reduce((x, y) => x + y, 0);
}
`
    );

    const report = analyzeFilesQuality(target, ['src/service.ts']);
    assert.equal(report.passed, false);
    assert.ok(report.complex_functions.some((fn) => fn.name === 'overlyComplex' && fn.complexity >= 10));
    assert.ok(report.duplicates.some((dup) =>
      dup.similarity >= 0.8
      && [dup.first.name, dup.second.name].sort().join(',') === 'processAlphaRecords,processBetaRecords'
    ));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-quality CLI passes on clean code and fails on complexity or duplication violations', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-quality-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'src/clean.ts'),
      'export function sum(items: number[]): number { return items.reduce((a, b) => a + b, 0); }\n'
    );

    const passOutput = runTs(cli, ['--check-quality', '--skip-update-check'], { cwd: target });
    assert.match(passOutput, /ForgeAI code quality check/);
    assert.match(passOutput, /Result: code quality gate satisfied\./);

    fs.writeFileSync(
      path.join(target, 'src/messy.ts'),
      `
export function branchHeavy(a: number, b: number, c: number, d: boolean, e: boolean) {
  if (a > 0 && b > 0) {
    if (c > 0 || d) {
      for (let i = 0; i < a; i++) {
        while (b > 0 && e) {
          if (i === b) return 1;
          b--;
        }
      }
    } else if (a < 0 || c < 0) {
      return d ? 2 : 3;
    }
  }
  return 0;
}
`
    );

    assert.throws(
      () => runTs(cli, ['--check-quality', '--skip-update-check'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /branchHeavy/);
        assert.match(stdout, /Result: code quality gate failed/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('code-quality module itself satisfies ub-mode complexity (< 10) and duplication (< 0.8) gates', () => {
  const selfReport = analyzeFilesQuality(projectRoot, ['bin/lib/code-quality.ts', 'bin/lib/symbol-matching.ts'], {
    compareAgainstRepo: false
  });
  assert.equal(selfReport.passed, true);
  assert.equal(selfReport.complex_functions.length, 0);
  assert.equal(selfReport.duplicates.length, 0);
});

test('analyzeFilesQuality extracts class methods, computes real CRAP from LCOV coverage, and catches duplication against unchanged repo files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-quality-advanced-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.mkdirSync(path.join(target, 'coverage'), { recursive: true });

    // Unchanged file in the repository
    fs.writeFileSync(
      path.join(target, 'src/existing.ts'),
      `
export function legacyBillingCalc(items: Array<{ price: number; qty: number; active: boolean }>) {
  const results: number[] = [];
  for (const item of items) {
    if (!item.active || item.qty <= 0) continue;
    const subtotal = item.price * item.qty;
    if (subtotal > 100) {
      results.push(subtotal * 0.9);
    } else {
      results.push(subtotal);
    }
  }
  return results.reduce((sum, val) => sum + val, 0);
}
`
    );

    // Changed file with a class method that has moderate complexity (4) but 0% coverage (CRAP = 16 + 4 = 20 >= 10),
    // and a method cloned from src/existing.ts
    fs.writeFileSync(
      path.join(target, 'src/invoice-service.ts'),
      `
export class InvoiceService {
  computeRisk(a: number, b: number, c: boolean): number {
    if (a > 10 && b > 5) {
      return c ? 2 : 1;
    }
    return 0;
  }

  clonedBillingCalc(lines: Array<{ cost: number; count: number; enabled: boolean }>) {
    const totals: number[] = [];
    for (const line of lines) {
      if (!line.enabled || line.count <= 0) continue;
      const amount = line.cost * line.count;
      if (amount > 100) {
        totals.push(amount * 0.9);
      } else {
        totals.push(amount);
      }
    }
    return totals.reduce((acc, cur) => acc + cur, 0);
  }
}
`
    );

    // Without LCOV coverage, coverage and crap_score are null (not faked as 1)
    const noCovReport = analyzeFilesQuality(target, ['src/invoice-service.ts']);
    assert.equal(noCovReport.functions_analyzed, 2);
    // Cloned method is caught against unchanged src/existing.ts!
    assert.ok(noCovReport.duplicates.some((dup) =>
      dup.first.name === 'InvoiceService.clonedBillingCalc' && dup.second.name === 'legacyBillingCalc'
    ));

    // Write LCOV using an absolute SF: path showing 0% coverage on InvoiceService.computeRisk (lines 3-8)
    fs.writeFileSync(
      path.join(target, 'coverage/lcov.info'),
      [
        `SF:${path.join(target, 'src/invoice-service.ts')}`,
        'DA:3,0',
        'DA:4,0',
        'DA:5,0',
        'DA:7,0',
        'end_of_record'
      ].join('\n')
    );

    const covReport = analyzeFilesQuality(target, ['src/invoice-service.ts']);
    const riskFn = covReport.complex_functions.find((fn) => fn.name === 'InvoiceService.computeRisk');
    assert.ok(riskFn, 'uncovered method with complexity 4 must fail CRAP >= 10');
    assert.equal(riskFn.coverage, 0);
    assert.equal(riskFn.crap_score, 20);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all runs the code quality check and review gate enforces Attack the Premise on 2 consecutive failures', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-premise-gate-'));
  try {
    runTs(cli, ['--skip-update-check'], { cwd: target });

    let checkAllOut = '';
    try {
      checkAllOut = runTs(cli, ['--check-all', '--skip-update-check'], { cwd: target, env: { ...process.env, PATH: '' } });
    } catch (error) {
      checkAllOut = String((error as ExecError).stdout ?? '');
    }
    assert.match(checkAllOut, /ForgeAI code quality check/);

    // Write a gated journal with 2 failed attempts on the same command and no Premise statement
    const id = 'TASK-20261103-retry-loop';
    fs.writeFileSync(
      path.join(target, '.ai/state/tasks', `${id}.md`),
      [
        '# Task Journal',
        '',
        '## Identity',
        `- Task ID: \`${id}\``,
        '- Current state: `review`',
        '',
        '## Commands And Validation',
        '| Date | Command/check | Result | Notes |',
        '| --- | --- | --- | --- |',
        '| 2026-11-03 | `npm test` | fail | attempt 1 |',
        '| 2026-11-03 | `npm test` | fail | attempt 2 |',
        '| 2026-11-03 | `npm test` | pass | attempt 3 |',
        '',
        '## Review Findings',
        '| Date | Reviewer | Status | Findings | Resolution |',
        '| --- | --- | --- | --- | --- |',
        '| 2026-11-03 | Reviewer | Approve | ok | resolved |'
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(target, '.ai/state/reviews', `${id}.md`),
      ['# Scorecard', `- Task ID: \`${id}\``, 'Unresolved blockers: none', 'Verdict: Approve'].join('\n')
    );

    assert.throws(
      () => runTs(cli, ['--check-review', '--skip-update-check'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /Attack the Premise/i);
        return true;
      }
    );

    // Adding a Premise statement satisfies the gate
    fs.appendFileSync(
      path.join(target, '.ai/state/tasks', `${id}.md`),
      '\n## Premise Check\n\nPremise: Assumed synchronous token flushing while parser held buffered state.\n'
    );
    const reviewPass = runTs(cli, ['--check-review', '--skip-update-check'], { cwd: target });
    assert.match(reviewPass, /Result: review gate satisfied\./);

    // Non-consecutive failures (fail -> pass -> fail -> pass) do not trigger a false Attack-the-Premise block
    const nonConsecutiveId = 'TASK-20261103-non-consecutive';
    fs.writeFileSync(
      path.join(target, '.ai/state/tasks', `${nonConsecutiveId}.md`),
      [
        '# Task Journal',
        '',
        '## Identity',
        `- Task ID: \`${nonConsecutiveId}\``,
        '- Current state: `review`',
        '',
        '## Commands And Validation',
        '| Date | Command/check | Result | Notes |',
        '| --- | --- | --- | --- |',
        '| 2026-11-03 | `npm test` | fail | initial red test |',
        '| 2026-11-03 | `npm test` | pass | green |',
        '| 2026-11-03 | `npm test` | fail | second red test |',
        '| 2026-11-03 | `npm test` | pass | green |',
        '',
        '## Review Findings',
        '| Date | Reviewer | Status | Findings | Resolution |',
        '| --- | --- | --- | --- | --- |',
        '| 2026-11-03 | Reviewer | Approve | ok | resolved |'
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(target, '.ai/state/reviews', `${nonConsecutiveId}.md`),
      ['# Scorecard', `- Task ID: \`${nonConsecutiveId}\``, 'Unresolved blockers: none', 'Verdict: Approve'].join('\n')
    );
    const nonConsecutiveOut = runTs(cli, ['--check-review', '--skip-update-check'], { cwd: target });
    assert.match(nonConsecutiveOut, /Result: review gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('task execution fails when an adapter introduces a code-quality violation', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-quality-fail-'));
  try {
    fs.mkdirSync(path.join(target, '.ai'), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, 'templates/.ai/RULES.md'), path.join(target, '.ai/RULES.md'));
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src/input.ts'), 'export const input = true;\n');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    const messyCode = [
      'export function tooComplex(a: number, b: number, c: number, d: boolean, e: boolean) {',
      '  if (a > 0 && b > 0) {',
      '    if (c > 0 || d) {',
      '      for (let i = 0; i < a; i++) {',
      '        while (b > 0 && e) { if (i === b) return 1; b--; }',
      '      }',
      '    } else if (a < 0 || c < 0) { return d ? 2 : 3; }',
      '  }',
      '  return 0;',
      '}'
    ].join('\\n');
    fs.writeFileSync(
      path.join(target, '.ai/cli-adapters.json'),
      JSON.stringify({
        version: 1,
        adapters: {
          fixture: {
            command: process.execPath,
            args: ['-e', `require('fs').appendFileSync('src/input.ts', '${messyCode}\\n')`],
            input: 'stdin'
          }
        }
      })
    );
    execFileSync('git', ['init', '-q'], { cwd: target });

    assert.throws(
      () => runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'add complex helper'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        const report = JSON.parse(stdout) as { status: string; validations: Array<{ name: string; passed: boolean; output: string }> };
        assert.equal(report.status, 'failed');
        const qualityValidation = report.validations.find((v) => v.name === 'code-quality');
        assert.ok(qualityValidation);
        assert.equal(qualityValidation.passed, false);
        assert.match(qualityValidation.output, /tooComplex/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
