import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';

export type MemoryFinding = { severity: 'fail' | 'warn'; location: string; detail: string };

export const MEMORY_RELATIVE_PATH = '.ai/MEMORY.md';

const PATH_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|py|rb|go|rs|java|kt|swift|sh|bash|zsh|ps1|css|scss|html|sql|toml|txt)$/i;

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

// Tasks 2-4 extend this with the individual stale-memory signals.
export function collectFindings(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  findings.push(...findDeadPathRefs(text, rootDir));
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
