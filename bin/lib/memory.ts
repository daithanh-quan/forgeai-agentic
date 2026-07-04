import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';

export type MemoryFinding = { severity: 'fail' | 'warn'; location: string; detail: string };

export const MEMORY_RELATIVE_PATH = '.ai/MEMORY.md';
export const DEFAULT_MAX_AGE_DAYS = 180;
export const DATED_HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+)$/;

const PATH_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|py|rb|go|rs|java|kt|swift|sh|bash|zsh|ps1|css|scss|html|sql|toml|txt)$/i;
// Bound to a single line to prevent ReDoS on unterminated directives.
const DIRECTIVE_PATTERN = /<!--[^\S\n]*forgeai-memory:([^>\n]*)-->/;

// A token counts as a repo path only when it has a known source extension or
// a trailing slash (directory reference). Everything ambiguous is skipped so
// prose, commands, package names, globs, and placeholders never fail the gate.
function looksLikeRepoPath(token: string): boolean {
  if (token.includes('*') || token.includes('<') || token.includes(' ')) return false;
  if (token.includes('TODO') || token.includes('YYYY')) return false;
  if (token.startsWith('-') || token.startsWith('@') || token.startsWith('/') || token.startsWith('~')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  const withoutLineRef = token.replace(/:\d+([-,]\d+)?$/, '');
  if (withoutLineRef.endsWith('/')) return true;
  return PATH_EXTENSIONS.test(withoutLineRef);
}

export function findDeadPathRefs(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim();
      if (!looksLikeRepoPath(token)) continue;
      const cleaned = token.replace(/^\.\//, '').replace(/:\d+([-,]\d+)?$/, '');
      if (!fs.existsSync(path.join(rootDir, cleaned))) {
        // MEMORY.md lives in .ai/, so references are commonly written .ai-relative;
        // upgrade-preserved files from older templates use that form.
        if (fs.existsSync(path.join(rootDir, '.ai', cleaned))) continue;
        findings.push({
          severity: 'fail',
          location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
          detail: `references missing path \`${token}\``
        });
      }
    }
  });
  return findings;
}

export function parseMaxAgeDays(text: string): { maxAgeDays: number; warning: string | null } {
  const directive = text.match(DIRECTIVE_PATTERN);
  if (!directive) return { maxAgeDays: DEFAULT_MAX_AGE_DAYS, warning: null };
  const value = directive[1].match(/max-age-days\s*=\s*(\S+)/);
  if (!value) return { maxAgeDays: DEFAULT_MAX_AGE_DAYS, warning: null };
  const parsed = Number(value[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      maxAgeDays: DEFAULT_MAX_AGE_DAYS,
      warning: `invalid forgeai-memory max-age-days value "${value[1]}"; using default ${DEFAULT_MAX_AGE_DAYS}`
    };
  }
  return { maxAgeDays: parsed, warning: null };
}

export function findTodoPlaceholders(text: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/\bTODO\b/.test(line)) {
      findings.push({
        severity: 'warn',
        location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
        detail: 'unfilled TODO placeholder'
      });
    }
  });
  return findings;
}

export function findStaleEntries(text: string, maxAgeDays: number, now: Date): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  text.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(DATED_HEADING);
    if (!heading) return;
    const entryTime = Date.parse(heading[1]);
    if (Number.isNaN(entryTime) || entryTime >= cutoff) return;
    findings.push({
      severity: 'warn',
      location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
      detail: `entry dated ${heading[1]} is older than ${maxAgeDays} days; re-validate or prune`
    });
  });
  return findings;
}

export function findMalformedEntries(text: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const lines = text.split(/\r?\n/);
  let inDecisions = false;
  let entryStart = -1;
  let entryBody: string[] = [];

  const flushEntry = () => {
    if (entryStart === -1) return;
    const body = entryBody.join('\n');
    for (const field of ['Decision', 'Why', 'Impact']) {
      if (!body.includes(`**${field}:**`)) {
        findings.push({
          severity: 'warn',
          location: `${MEMORY_RELATIVE_PATH}:${entryStart + 1}`,
          detail: `decision entry is missing **${field}:**`
        });
      }
    }
    entryStart = -1;
    entryBody = [];
  };

  lines.forEach((line, index) => {
    if (/^##\s/.test(line)) {
      flushEntry();
      inDecisions = /^##\s+Architecture decisions\b/.test(line);
      return;
    }
    if (!inDecisions) return;
    if (/^###\s/.test(line)) {
      flushEntry();
      if (!DATED_HEADING.test(line)) {
        findings.push({
          severity: 'warn',
          location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
          detail: 'decision heading does not match "### YYYY-MM-DD — Title"'
        });
        return;
      }
      entryStart = index;
      return;
    }
    if (entryStart !== -1) entryBody.push(line);
  });
  flushEntry();
  return findings;
}

// Aggregates the stale-memory signals in report order.
export function collectFindings(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const { maxAgeDays, warning } = parseMaxAgeDays(text);
  if (warning) findings.push({ severity: 'warn', location: MEMORY_RELATIVE_PATH, detail: warning });
  findings.push(
    ...findDeadPathRefs(text, rootDir),
    ...findTodoPlaceholders(text),
    ...findStaleEntries(text, maxAgeDays, new Date()),
    ...findMalformedEntries(text)
  );
  return findings;
}

export function runCheckMemory(): void {
  console.log('ForgeAI memory check');
  console.log('');

  const memoryPath = path.join(root, MEMORY_RELATIVE_PATH);
  if (!fs.existsSync(memoryPath)) {
    console.log(formatStatus('fail', `${MEMORY_RELATIVE_PATH} not found`));
    console.log('');
    console.log('Result: memory check failed. Run npx forgeai-agentic-init to install the harness.');
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(memoryPath, 'utf8');
  const findings = collectFindings(text, root);

  if (findings.length === 0) {
    console.log(formatStatus('ok', 'no stale-memory signals detected'));
  } else {
    for (const finding of findings) {
      console.log(formatStatus(finding.severity, `${finding.location}: ${finding.detail}`));
    }
  }

  console.log('');
  if (findings.some((finding) => finding.severity === 'fail')) {
    console.log('Result: memory check failed. Fix or remove entries that reference missing paths.');
    process.exitCode = 1;
    return;
  }
  if (findings.length > 0) {
    console.log(
      'Result: memory check passed with warnings. Re-validate stale entries, fill TODOs, and prune superseded knowledge.'
    );
    return;
  }
  console.log('Result: memory check passed.');
}
