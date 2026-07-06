import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';
import { listTaskJournalFiles, parseTaskJournal } from './lifecycle.js';

const GATED_STATES = new Set(['review', 'revision', 'acceptance', 'delivery', 'closed']);
const HIGH_RISK_TASK_TYPES = new Set(['dependency-upgrade']);

const HIGH_RISK_PATTERNS = [
  /\bauth(?:entication|orization)?\b/i,
  /\bsecurity\b/i,
  /\bmigratio?n\b/i,
  /\bpayment\b/i,
  /\bbilling\b/i,
  /\bsecret\b/i,
  /\bcredential\b/i,
  /\bprivate[\s_-]key\b/i,
  /\bproduction\b/i,
  /\b(?:drop|truncate)\s+table\b/i,
  /--force\b/,
  /\bdestructive\b/i
];

const APPROVAL_HEADING = /^##\s+Approval\b/im;
const APPROVAL_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const SIGNED_BY = /(?:signed|approved)\s+by|human\s+sign[-\s]?off|sign[-\s]?off/i;

function stripApprovalSection(content: string): string {
  const match = APPROVAL_HEADING.exec(content);
  if (!match) return content;
  return content.slice(0, match.index);
}

export function isHighRisk(content: string, taskType: string): boolean {
  if (HIGH_RISK_TASK_TYPES.has(taskType)) return true;
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(stripApprovalSection(content)));
}

export function hasApprovalSection(content: string): boolean {
  const headingMatch = APPROVAL_HEADING.exec(content);
  if (!headingMatch) return false;
  const sectionStart = headingMatch.index;
  const sectionEnd = content.indexOf('\n## ', sectionStart + 4);
  const section = content.slice(sectionStart, sectionEnd === -1 ? sectionStart + 600 : sectionEnd);
  return APPROVAL_DATE.test(section) || SIGNED_BY.test(section);
}

export function runCheckApproval(): void {
  console.log('ForgeAI approval gate check');
  console.log('');

  const journals = listTaskJournalFiles();

  if (journals.length === 0) {
    console.log(formatStatus('ok', 'no task journals found'));
    console.log('');
    console.log('Result: approval gate satisfied.');
    return;
  }

  let failures = 0;
  let gatedHighRisk = 0;

  for (const file of journals) {
    const journal = parseTaskJournal(file);
    if (!GATED_STATES.has(journal.currentState)) continue;

    const content = fs.readFileSync(path.join(root, file), 'utf8');
    if (!isHighRisk(content, journal.taskType)) continue;

    gatedHighRisk += 1;
    const label = `${file}${journal.taskId ? ` (${journal.taskId})` : ''}`;

    if (!hasApprovalSection(content)) {
      failures += 1;
      console.log(
        formatStatus('fail', `${label} — high-risk task in "${journal.currentState}" state requires ## Approval section with sign-off date`)
      );
    } else {
      console.log(formatStatus('ok', `${label} — approval section found`));
    }
  }

  if (gatedHighRisk === 0) {
    console.log(formatStatus('ok', 'no high-risk task journals in gated states'));
  }

  console.log('');
  if (failures > 0) {
    console.log(
      'Result: approval gate failed. Add an ## Approval section with a human sign-off date to each high-risk task journal before proceeding.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('Result: approval gate satisfied.');
}
