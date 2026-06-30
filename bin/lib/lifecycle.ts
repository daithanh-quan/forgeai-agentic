import fs from 'node:fs';
import path from 'node:path';
import type { TaskJournal } from './types.js';
import { root } from './context.js';
import { formatStatus } from './utils.js';
import { cleanTableCell } from './sessions.js';

export const lifecycleStates = [
  'intake',
  'triage',
  'planning',
  'specification',
  'assignment',
  'execution',
  'validation',
  'review',
  'revision',
  'acceptance',
  'delivery',
  'memory-update',
  'closed'
];
export const taskTypes = ['bug', 'feature', 'refactor', 'research', 'audit', 'incident', 'release', 'dependency-upgrade'];

export function extractBulletValue(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^-\\s+${escaped}:\\s*(.+)$`, 'im'));
  return cleanTableCell(match?.[1]);
}

export function isChecked(content: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^-\\s+\\[[xX]\\]\\s+${escaped}\\s*$`, 'm').test(content);
}

export function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function daysSince(date: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

export function isClosedLifecycleState(state: string): boolean {
  return state === 'closed';
}

export function isTerminalLifecycleState(state: string): boolean {
  return ['closed', 'cancelled', 'canceled'].includes(state);
}

export function listTaskJournalFiles(): string[] {
  const tasksDir = path.join(root, '.ai', 'state', 'tasks');
  if (!fs.existsSync(tasksDir)) return [];

  return fs
    .readdirSync(tasksDir)
    .filter((fileName) => fileName.endsWith('.md') && fileName !== '_template.md')
    .map((fileName) => `.ai/state/tasks/${fileName}`)
    .sort();
}

export function parseTaskJournal(relativePath: string): TaskJournal {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return {
    file: relativePath,
    taskId: extractBulletValue(content, 'Task ID'),
    taskType: extractBulletValue(content, 'Task type').toLowerCase(),
    currentState: extractBulletValue(content, 'Current state').toLowerCase(),
    lastUpdated: extractBulletValue(content, 'Last updated'),
    staleStatus: extractBulletValue(content, 'Stale status').toLowerCase(),
    memoryUpdateChecked: isChecked(content, 'Update `.ai/MEMORY.md`'),
    noMemoryUpdateChecked: isChecked(content, 'No memory update needed')
  };
}

export function runCheckLifecycle(): void {
  console.log('ForgeAI lifecycle check');
  console.log('');

  const requiredLifecycleFiles = ['.ai/state/lifecycle.md', '.ai/state/tasks/_template.md', '.ai/workflows/lifecycle-management.md'];
  let failures = 0;
  let staleTasks = 0;

  for (const relativePath of requiredLifecycleFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const taskFiles = listTaskJournalFiles();
  console.log('');
  console.log('Task journals');

  if (taskFiles.length === 0) {
    console.log(formatStatus('ok', 'no real task journals recorded'));
  }

  for (const taskFile of taskFiles) {
    const journal = parseTaskJournal(taskFile);
    const label = `${taskFile}${journal.taskId ? ` (${journal.taskId})` : ''}`;
    let journalFailures = 0;

    if (!journal.taskId || journal.taskId === 'TASK-YYYYMMDD-short-slug' || journal.taskId === 'TASK-...') {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} missing real Task ID`));
    }

    if (!taskTypes.includes(journal.taskType)) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid task type: ${journal.taskType || 'missing'}`));
    }

    if (!lifecycleStates.includes(journal.currentState)) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid lifecycle state: ${journal.currentState || 'missing'}`));
    }

    const lastUpdated = parseDateOnly(journal.lastUpdated);
    if (!lastUpdated) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid Last updated: ${journal.lastUpdated || 'missing'}`));
    } else if (!isTerminalLifecycleState(journal.currentState)) {
      const ageDays = daysSince(lastUpdated);
      if (ageDays > 7) {
        staleTasks += 1;
        const status = journal.staleStatus === 'stale' ? 'stale' : 'needs refresh';
        console.log(formatStatus(status, `${taskFile} last updated ${ageDays} days ago`));
      }
    }

    if (isClosedLifecycleState(journal.currentState)) {
      const memoryDecisions = Number(journal.memoryUpdateChecked) + Number(journal.noMemoryUpdateChecked);
      if (memoryDecisions !== 1) {
        journalFailures += 1;
        console.log(formatStatus('invalid', `${taskFile} closed without exactly one memory update decision`));
      }
    }

    if (journalFailures === 0) {
      const state = isClosedLifecycleState(journal.currentState) ? 'closed' : 'active';
      console.log(formatStatus(state, `${label} state: ${journal.currentState}`));
    }

    failures += journalFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: lifecycle journals need fixes before reliable agent handoff.');
    process.exitCode = 1;
    return;
  }

  if (staleTasks > 0) {
    console.log('Result: lifecycle journals have stale active work. Refresh assumptions and validation before resuming.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: lifecycle state is usable.');
}

