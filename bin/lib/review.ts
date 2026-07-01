import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';
import { splitTableRow, cleanTableCell } from './sessions.js';
import { listTaskJournalFiles, parseTaskJournal } from './lifecycle.js';

export const gatedReviewStates = ['review', 'revision', 'acceptance', 'delivery', 'closed'];
export const validRecommendations = ['approve', 'request changes', 'needs human decision'];
const validEvidenceResults = ['pass', 'fail', 'skipped'];

// Return the data rows (header and divider dropped) of the markdown table that
// appears under the given `## heading`.
export function extractTableRows(content: string, heading: string): string[][] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return [];

  const tableLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('## ')) break;
    if (line.startsWith('|')) tableLines.push(line);
  }

  const dataLines = tableLines.filter((line) => !/^\|[\s:|-]+\|$/.test(line));
  if (dataLines.length <= 1) return [];

  return dataLines.slice(1).map((line) => splitTableRow(line).map((cell) => cleanTableCell(cell)));
}

// Read a `Label: value` line and return the trimmed value.
export function extractLabeledValue(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*${escaped}:\\s*(.*)$`, 'im'));
  return cleanTableCell(match?.[1] ?? '');
}

// A real evidence row is not the template placeholder and has a concrete result.
export function isRealEvidenceRow(cells: string[]): boolean {
  const [date, command, result] = cells;
  if (!date || date === 'YYYY-MM-DD') return false;
  if (!command || command === '...') return false;
  return validEvidenceResults.includes((result ?? '').toLowerCase());
}

// A real finding row is not the placeholder and carries a valid recommendation.
export function isRealFindingRow(cells: string[]): boolean {
  const [date, reviewer, status] = cells;
  if (!date || date === 'YYYY-MM-DD') return false;
  if (!reviewer || reviewer === '...') return false;
  return validRecommendations.includes((status ?? '').toLowerCase());
}

export function runCheckReview(): void {
  console.log('ForgeAI review gate check');
  console.log('');

  const requiredFiles = [
    '.ai/state/reviews/_template.md',
    '.ai/workflows/quality-gates.md',
    '.ai/workflows/pre-merge-checklist.md'
  ];
  let failures = 0;

  for (const relativePath of requiredFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const gatedJournals = listTaskJournalFiles()
    .map((file) => ({ file, journal: parseTaskJournal(file), content: fs.readFileSync(path.join(root, file), 'utf8') }))
    .filter((entry) => gatedReviewStates.includes(entry.journal.currentState));

  console.log('');
  console.log('Review gate');

  if (gatedJournals.length === 0) {
    console.log(formatStatus('ok', 'no task journals awaiting the review gate'));
  }

  for (const { file, journal, content } of gatedJournals) {
    const label = `${file}${journal.taskId ? ` (${journal.taskId})` : ''}`;
    let journalFailures = 0;

    const evidenceRows = extractTableRows(content, 'Commands And Validation').filter(isRealEvidenceRow);
    if (evidenceRows.length === 0) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${file} has no real validation evidence in ${journal.currentState} state`));
    }

    const findingRows = extractTableRows(content, 'Review Findings').filter(isRealFindingRow);
    if (findingRows.length === 0) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${file} has no review finding with a recommendation`));
    }

    const scorecardRelative = journal.taskId ? `.ai/state/reviews/${journal.taskId}.md` : '';
    const scorecardAbsolute = scorecardRelative ? path.join(root, scorecardRelative) : '';

    if (!scorecardRelative || !fs.existsSync(scorecardAbsolute)) {
      journalFailures += 1;
      console.log(formatStatus('missing', `${scorecardRelative || '.ai/state/reviews/<task-id>.md'} scorecard for ${label}`));
    } else {
      const scorecard = fs.readFileSync(scorecardAbsolute, 'utf8');

      if (/\bTODO\b/.test(scorecard)) {
        journalFailures += 1;
        console.log(formatStatus('needs review', `${scorecardRelative} still contains TODO`));
      }

      const verdict = extractLabeledValue(scorecard, 'Verdict').toLowerCase();
      if (!validRecommendations.includes(verdict)) {
        journalFailures += 1;
        console.log(formatStatus('invalid', `${scorecardRelative} Verdict must be Approve, Request changes, or Needs human decision`));
      } else if (verdict === 'approve') {
        const blockers = extractLabeledValue(scorecard, 'Unresolved blockers').toLowerCase();
        if (blockers !== '' && blockers !== 'none') {
          journalFailures += 1;
          console.log(formatStatus('invalid', `${scorecardRelative} verdict Approve but unresolved blockers: ${blockers}`));
        }
      }
    }

    if (journalFailures === 0) {
      console.log(formatStatus('ok', `${label} passes the review gate`));
    }
    failures += journalFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: review gate failed. Add real validation evidence and a completed scorecard before closing.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: review gate satisfied.');
}
