import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './context.js';
import { runGit } from './utils.js';

const TODAY = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
const SCRIPT_PRIORITY = ['typecheck', 'lint', 'test', 'build'] as const;
const MAX_FAILURE_LINES = 20;
const MAX_DIFF_FILES = 30;

type GitStatusEntry = {
  index: string;
  worktree: string;
  file: string;
};

function parseShortStatus(raw: string): GitStatusEntry[] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      index: line[0] ?? ' ',
      worktree: line[1] ?? ' ',
      file: line.slice(3)
    }));
}

function countByCategory(entries: GitStatusEntry[]): { staged: number; unstaged: number; untracked: number } {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const { index, worktree } of entries) {
    if (index === '?' && worktree === '?') { untracked += 1; continue; }
    if (index !== ' ') staged += 1;
    if (worktree !== ' ') unstaged += 1;
  }
  return { staged, unstaged, untracked };
}

function statusLabel(entry: GitStatusEntry): string {
  if (entry.index === '?' && entry.worktree === '?') return 'untracked';
  const parts: string[] = [];
  if (entry.index !== ' ') parts.push('staged');
  if (entry.worktree !== ' ') parts.push('unstaged');
  return parts.join('+');
}

export function buildStatusSummary(): string {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const lastCommit = runGit(['log', '-1', '--oneline']);
  const statusResult = runGit(['status', '--short']);

  const branchName = branch.status === 0 ? branch.stdout.trim() : 'unknown';
  const commitLine = lastCommit.status === 0 ? lastCommit.stdout.trim() : 'no commits';

  if (statusResult.status !== 0) {
    return `# Git Status Summary\n\n- Error: ${statusResult.stderr.trim() || 'git status failed'}\n`;
  }

  const entries = parseShortStatus(statusResult.stdout);
  const { staged, unstaged, untracked } = countByCategory(entries);

  const fileLines = entries
    .map((e) => `- \`${e.index}${e.worktree}\` ${e.file} (${statusLabel(e)})`)
    .join('\n');

  return `# Git Status Summary

- Generated: ${TODAY}
- Branch: ${branchName}
- Last commit: ${commitLine}
- Staged: ${staged}
- Unstaged: ${unstaged}
- Untracked: ${untracked}
- Total changes: ${entries.length}
${entries.length === 0 ? '\nWorking tree is clean.' : `\n## Changed Files\n\n${fileLines}`}
`;
}

export function buildDiffSummary(): string {
  const diffStat = runGit(['diff', '--stat', 'HEAD']);

  if (diffStat.status !== 0) {
    const shortDiff = runGit(['diff', '--stat']);
    if (shortDiff.status !== 0) {
      return `# Diff Summary\n\n- Error: ${diffStat.stderr.trim() || 'git diff failed'}\n`;
    }
    return formatDiffOutput(shortDiff.stdout, '(unstaged only — no HEAD commit)');
  }

  return formatDiffOutput(diffStat.stdout, '');
}

function formatDiffOutput(raw: string, note: string): string {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return `# Diff Summary\n\n- No changes detected.\n`;
  }

  const summaryLine = lines.at(-1) ?? '';
  const fileLines = lines.slice(0, -1).slice(0, MAX_DIFF_FILES);
  const truncated = lines.length - 1 > MAX_DIFF_FILES;

  const tableRows = fileLines
    .map((line) => {
      const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([\+\-]*)$/);
      if (!match) return `| ${line.trim()} | — | — |`;
      const [, file, count, bars] = match;
      const ins = (bars?.match(/\+/g) ?? []).length;
      const del = (bars?.match(/-/g) ?? []).length;
      const total = Number(count);
      return `| ${file?.trim()} | +${ins > 0 ? Math.round((ins / (ins + del)) * total) : 0} | -${del > 0 ? Math.round((del / (ins + del)) * total) : 0} |`;
    })
    .join('\n');

  return `# Diff Summary
${note ? `\n> ${note}\n` : ''}
- Generated: ${TODAY}
- Summary: ${summaryLine}
${truncated ? `- (showing first ${MAX_DIFF_FILES} of ${lines.length - 1} files)\n` : ''}
## Changed Files

| File | Insertions | Deletions |
| --- | --- | --- |
${tableRows || '| — | — | — |'}
`;
}

type PackageScripts = Record<string, string>;

function detectScripts(scriptsRecord: PackageScripts): string[] {
  return SCRIPT_PRIORITY.filter((name) => name in scriptsRecord);
}

function detectPackageManager(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function runScript(manager: string, scriptName: string, cwd: string): { passed: boolean; durationMs: number; output: string } {
  const start = Date.now();
  const result = spawnSync(manager, ['run', scriptName], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    timeout: 120_000
  });
  const durationMs = Date.now() - start;
  const passed = result.status === 0 && !result.error;
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const truncated = combined.split(/\r?\n/).slice(0, MAX_FAILURE_LINES).join('\n');
  return { passed, durationMs, output: truncated };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildTestSummary(): string {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return `# Test Summary\n\n- Error: package.json not found in ${root}\n`;
  }

  let scripts: PackageScripts = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: PackageScripts };
    scripts = pkg.scripts ?? {};
  } catch {
    return `# Test Summary\n\n- Error: could not parse package.json\n`;
  }

  const detected = detectScripts(scripts);
  if (detected.length === 0) {
    return `# Test Summary\n\n- No recognised scripts found (looked for: ${SCRIPT_PRIORITY.join(', ')}).\n- Available scripts: ${Object.keys(scripts).join(', ') || 'none'}\n`;
  }

  const manager = detectPackageManager(root);
  const results: Array<{ name: string; passed: boolean; durationMs: number; output: string }> = [];
  let stopped = false;

  for (const name of detected) {
    const { passed, durationMs, output } = runScript(manager, name, root);
    results.push({ name, passed, durationMs, output });
    if (!passed) { stopped = true; break; }
  }

  const overall = results.every((r) => r.passed) ? 'pass' : 'fail';
  const tableRows = results
    .map((r) => `| ${r.name} | ${r.passed ? 'pass' : 'fail'} | ${formatDuration(r.durationMs)} |`)
    .join('\n');

  const failureBlocks = results
    .filter((r) => !r.passed)
    .map((r) => `## Failure: ${r.name}\n\n\`\`\`\n${r.output || '(no output)'}\n\`\`\``)
    .join('\n\n');

  const skippedNote = stopped && results.length < detected.length
    ? `\n> Stopped after first failure. Skipped: ${detected.slice(results.length).join(', ')}.`
    : '';

  return `# Test Summary

- Generated: ${TODAY}
- Package manager: ${manager}
- Scripts detected: ${detected.join(', ')}
- Overall: **${overall}**
${skippedNote}

## Results

| Script | Status | Duration |
| --- | --- | --- |
${tableRows}
${failureBlocks ? `\n${failureBlocks}\n` : ''}`;
}

export function runStatusSummary(): void {
  process.stdout.write(buildStatusSummary());
}

export function runDiffSummary(): void {
  process.stdout.write(buildDiffSummary());
}

export function runTestSummary(): void {
  process.stdout.write(buildTestSummary());
}
