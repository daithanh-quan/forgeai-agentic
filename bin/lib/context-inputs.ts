import fs from 'node:fs';
import path from 'node:path';
import type { CompiledDiagnostics, CompiledRuleSection } from './types.js';
import { symbolMatchesObjective } from './symbol-matching.js';
import { runCommand } from './utils.js';
import { templateDir } from './context.js';

const MAX_DIAGNOSTIC_FILES = 10;
const ALWAYS_RULE_HEADINGS = new Set([
  'non-negotiable safety rules',
  'before editing code',
  'code quality rules',
  'validation order',
  'required final response format'
]);

type MarkdownSection = {
  heading: string;
  startLine: number;
  endLine: number;
  content: string;
};

function parseRuleSections(content: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const starts: Array<{ index: number; heading: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) starts.push({ index, heading: match[1] });
  }
  return starts.map((start, index) => {
    const endIndex = starts[index + 1]?.index ?? lines.length;
    return {
      heading: start.heading,
      startLine: start.index + 1,
      endLine: endIndex,
      content: lines.slice(start.index, endIndex).join('\n').trim()
    };
  });
}

function specializedRuleReason(heading: string, terms: string[]): string | null {
  const normalized = heading.toLowerCase();
  if (terms.some((term) => normalized.includes(term))) return 'heading matched objective';
  const has = (...values: string[]): boolean => terms.some((term) => values.some((value) => term.includes(value) || value.includes(term)));
  if (normalized === 'dependency rules' && has('dependency', 'package', 'install', 'upgrade', 'npm', 'yarn', 'pnpm', 'bun')) {
    return 'dependency/package task rule';
  }
  if (normalized === 'supply-chain and untrusted-source safety' && has('dependency', 'package', 'install', 'upgrade', 'security', 'secret', 'credential', 'token', 'fetch', 'web')) {
    return 'supply-chain or untrusted-input task rule';
  }
  if (normalized === 'git rules' && has('git', 'branch', 'commit', 'merge', 'pull', 'release')) {
    return 'git/release task rule';
  }
  if (normalized === 'shell output rules' && has('diagnostic', 'shell', 'status', 'diff', 'test', 'build', 'lint')) {
    return 'diagnostic/validation task rule';
  }
  return null;
}

export function selectApplicableRules(repositoryRoot: string, objectiveTerms: string[]): CompiledRuleSection[] {
  const relativePath = '.ai/RULES.md' as const;
  const projectPath = path.join(repositoryRoot, relativePath);
  // Context preview and single-agent handoff are intentionally usable before
  // initialization. Prefer project rules, but fall back to the packaged
  // baseline without writing it into the user's repository.
  const absolutePath = fs.existsSync(projectPath)
    ? projectPath
    : path.join(templateDir, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`${relativePath} not found and the packaged baseline is unavailable`);
  const sections = parseRuleSections(fs.readFileSync(absolutePath, 'utf8'));
  const selected: CompiledRuleSection[] = [];
  for (const section of sections) {
    const normalized = section.heading.toLowerCase();
    const always = ALWAYS_RULE_HEADINGS.has(normalized);
    const specializedReason = specializedRuleReason(section.heading, objectiveTerms);
    if (!always && !specializedReason) continue;
    selected.push({
      path: relativePath,
      heading: section.heading,
      reason: always ? 'mandatory baseline rule' : specializedReason!,
      source_start_line: section.startLine,
      source_end_line: section.endLine,
      content: section.content
    });
  }
  if (sections.length > 0 && selected.length === 0) {
    return sections.map((section) => ({
      path: relativePath,
      heading: section.heading,
      reason: 'custom rule file without recognized baseline headings',
      source_start_line: section.startLine,
      source_end_line: section.endLine,
      content: section.content
    }));
  }
  const seen = new Set<string>();
  return selected.filter((rule) => {
    if (seen.has(rule.content)) return false;
    seen.add(rule.content);
    return true;
  });
}

function parseMemoryBlocks(content: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const blocks: MarkdownSection[] = [];
  for (const section of parseRuleSections(content)) {
    if (section.heading.toLowerCase() === 'how to use this file') continue;
    if (section.heading.toLowerCase() !== 'architecture decisions') {
      blocks.push(section);
      continue;
    }
    const subStarts: Array<{ index: number; heading: string }> = [];
    for (let i = section.startLine; i < section.endLine; i += 1) {
      const sub = lines[i]?.match(/^###\s+(.+?)\s*$/);
      if (sub) subStarts.push({ index: i, heading: sub[1] });
    }
    if (subStarts.length === 0) {
      blocks.push(section);
      continue;
    }
    for (let idx = 0; idx < subStarts.length; idx += 1) {
      const start = subStarts[idx];
      const endLine = subStarts[idx + 1]?.index ?? section.endLine;
      blocks.push({
        heading: `Architecture decision: ${start.heading}`,
        startLine: start.index + 1,
        endLine,
        content: lines.slice(start.index, endLine).join('\n').trim()
      });
    }
  }
  return blocks;
}

function isUnpopulatedMemoryBlock(block: MarkdownSection): boolean {
  return /\bTODO\b/.test(block.content) || /\bYYYY-MM-DD\b/.test(block.heading) || /\bYYYY-MM-DD\b/.test(block.content);
}

function findReferencedSelectedPath(content: string, selectedFiles: string[]): string | null {
  if (selectedFiles.length === 0) return null;
  const lowerContent = content.toLowerCase();
  for (const filePath of selectedFiles) {
    const normalized = filePath.toLowerCase();
    if (lowerContent.includes(normalized)) return filePath;
  }
  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (token.length < 3 || token.includes('*')) continue;
    const hit = selectedFiles.find((file) => file === token || file.startsWith(`${token}/`));
    if (hit) return hit;
  }
  return null;
}

function memoryMatchReason(block: MarkdownSection, objectiveTerms: string[], selectedFiles: string[]): string | null {
  const pathHit = findReferencedSelectedPath(block.content, selectedFiles);
  if (pathHit) return `project memory references selected path "${pathHit}"`;
  if (objectiveTerms.length === 0) return null;
  if (symbolMatchesObjective([block.heading], objectiveTerms)) return 'project memory heading matched objective';
  const lowerBody = block.content.toLowerCase();
  const matchedTerm = objectiveTerms.find((term) => term.length >= 4 && lowerBody.includes(term));
  return matchedTerm ? `project memory matched objective term "${matchedTerm}"` : null;
}

export function selectApplicableMemory(
  repositoryRoot: string,
  objectiveTerms: string[],
  selectedFiles: string[] = []
): CompiledRuleSection[] {
  const relativePath = '.ai/MEMORY.md' as const;
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const blocks = parseMemoryBlocks(fs.readFileSync(absolutePath, 'utf8'));
  const selected: CompiledRuleSection[] = [];
  for (const block of blocks) {
    if (isUnpopulatedMemoryBlock(block)) continue;
    const reason = memoryMatchReason(block, objectiveTerms, selectedFiles);
    if (!reason) continue;
    selected.push({
      path: relativePath,
      heading: `Memory — ${block.heading}`,
      reason,
      source_start_line: block.startLine,
      source_end_line: block.endLine,
      content: block.content
    });
  }
  return selected;
}

function parseStatus(raw: string): {
  staged: number;
  unstaged: number;
  untracked: number;
  files: Array<{ path: string; state: string }>;
} {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const files: Array<{ path: string; state: string }> = [];
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    const file = line.slice(3);
    let state = '';
    if (index === '?' && worktree === '?') {
      untracked += 1;
      state = 'untracked';
    } else {
      const states: string[] = [];
      if (index !== ' ') { staged += 1; states.push('staged'); }
      if (worktree !== ' ') { unstaged += 1; states.push('unstaged'); }
      state = states.join('+');
    }
    files.push({ path: file, state });
  }
  return { staged, unstaged, untracked, files };
}

function parseDiff(raw: string): Array<{ path: string; insertions: number | null; deletions: number | null; binary: boolean }> {
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [insertions, deletions, file = ''] = line.split('\t');
    const binary = insertions === '-' || deletions === '-';
    return {
      path: file,
      insertions: binary ? null : Number(insertions),
      deletions: binary ? null : Number(deletions),
      binary
    };
  });
}

function validationSnapshot(repositoryRoot: string): CompiledDiagnostics['validation'] {
  const packagePath = path.join(repositoryRoot, 'package.json');
  if (!fs.existsSync(packagePath)) return { package_manager: null, scripts: [] };
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return { package_manager: null, scripts: [] };
  }
  const packageManager = fs.existsSync(path.join(repositoryRoot, 'pnpm-lock.yaml')) ? 'pnpm'
    : fs.existsSync(path.join(repositoryRoot, 'yarn.lock')) ? 'yarn'
      : fs.existsSync(path.join(repositoryRoot, 'bun.lockb')) ? 'bun'
        : 'npm';
  const priority = ['typecheck', 'lint', 'test', 'build'];
  return {
    package_manager: packageManager,
    scripts: priority.filter((name) => scripts[name]).map((name) => ({ name, command: scripts[name] }))
  };
}

export function collectDiagnostics(repositoryRoot: string): CompiledDiagnostics {
  const branch = runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repositoryRoot);
  const revision = runCommand('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const status = runCommand('git', ['status', '--short'], repositoryRoot);
  if (status.status !== 0) {
    return {
      git: {
        available: false, branch: null, revision: null, staged: 0, unstaged: 0, untracked: 0,
        changed_files: [], changed_files_truncated: false, diff: [], diff_truncated: false,
        error: (status.stderr || 'git status unavailable').trim()
      },
      validation: validationSnapshot(repositoryRoot)
    };
  }
  const parsedStatus = parseStatus(status.stdout);
  let diffResult = runCommand('git', ['diff', '--numstat', 'HEAD'], repositoryRoot);
  if (diffResult.status !== 0) diffResult = runCommand('git', ['diff', '--numstat'], repositoryRoot);
  const diff = diffResult.status === 0 ? parseDiff(diffResult.stdout) : [];
  return {
    git: {
      available: true,
      branch: branch.status === 0 ? branch.stdout.trim() || null : null,
      revision: revision.status === 0 ? revision.stdout.trim() || null : null,
      staged: parsedStatus.staged,
      unstaged: parsedStatus.unstaged,
      untracked: parsedStatus.untracked,
      changed_files: parsedStatus.files.slice(0, MAX_DIAGNOSTIC_FILES),
      changed_files_truncated: parsedStatus.files.length > MAX_DIAGNOSTIC_FILES,
      diff: diff.slice(0, MAX_DIAGNOSTIC_FILES),
      diff_truncated: diff.length > MAX_DIAGNOSTIC_FILES,
      error: diffResult.status === 0 ? null : (diffResult.stderr || 'git diff unavailable').trim()
    },
    validation: validationSnapshot(repositoryRoot)
  };
}
