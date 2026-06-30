import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession } from './types.js';
import { root } from './context.js';
import { formatStatus } from './utils.js';

export function cleanTableCell(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\\|/g, '|')
    .trim();
}

// Splits a markdown table row into cells, honoring `\|` as an escaped literal
// pipe rather than a column delimiter so scopes/paths/notes containing pipes do
// not silently shift later columns (which would hide real write-scope overlap).
export function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/);
}

export function parseScopeList(value: string): string[] {
  const cleaned = cleanTableCell(value);
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'none') return [];

  return cleaned
    .split(/,|<br\s*\/?>/i)
    .map((item) => cleanTableCell(item))
    .filter(Boolean);
}

export function normalizeScopePath(scope: string): string {
  const trimmed = scope
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');

  if (trimmed === '/') return '.';
  return trimmed.replace(/\/+$/, '') || '.';
}

export function isBroadScope(scope: string): boolean {
  const normalized = normalizeScopePath(scope).toLowerCase();
  return normalized === '.' || normalized === '*' || normalized === 'repo' || normalized === 'all' || normalized.includes('*');
}

export function scopesOverlap(left: string, right: string): boolean {
  const leftPath = normalizeScopePath(left);
  const rightPath = normalizeScopePath(right);

  if (isBroadScope(leftPath) || isBroadScope(rightPath)) return true;
  if (leftPath === rightPath) return true;
  if (leftPath.startsWith(`${rightPath}/`)) return true;
  if (rightPath.startsWith(`${leftPath}/`)) return true;
  return false;
}

export function parseSessionTable(content: string): AgentSession[] {
  const sessions: AgentSession[] = [];
  let inActiveSessions = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      inActiveSessions = /^##\s+Active Sessions\b/i.test(line);
      continue;
    }

    if (!inActiveSessions || !line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line) || /\|\s*ID\s*\|/i.test(line)) continue;

    const cells = splitTableRow(line).map((cell) => cell.trim());

    if (cells.length < 9) continue;

    const id = cleanTableCell(cells[0]);
    if (!id || id === 'example-session') continue;

    sessions.push({
      id,
      owner: cleanTableCell(cells[1]),
      task: cleanTableCell(cells[2]),
      branch: cleanTableCell(cells[3]),
      status: cleanTableCell(cells[4]).toLowerCase(),
      started: cleanTableCell(cells[5]),
      readScope: parseScopeList(cells[6]),
      writeScope: parseScopeList(cells[7]),
      notes: cleanTableCell(cells[8])
    });
  }

  return sessions;
}

export function isUnfinishedSession(session: AgentSession): boolean {
  return !['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled'].includes(session.status);
}

export function runCheckSessions(): void {
  console.log('ForgeAI session check');
  console.log('');

  const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');
  if (!fs.existsSync(sessionsPath)) {
    console.log(formatStatus('missing', '.ai/state/sessions.md'));
    console.log('');
    console.log('Result: session coordination file missing. Run forgeai-init --upgrade to install it.');
    process.exitCode = 1;
    return;
  }

  const sessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8'));
  const unfinished = sessions.filter(isUnfinishedSession);

  if (sessions.length === 0) {
    console.log(formatStatus('ok', 'no real sessions recorded'));
    console.log('');
    console.log('Result: no active session overlap detected.');
    return;
  }

  for (const session of sessions) {
    const writeScope = session.writeScope.length > 0 ? session.writeScope.join(', ') : 'missing';
    const status = isUnfinishedSession(session) ? 'active' : 'closed';
    console.log(formatStatus(status, `${session.id} ${session.status || 'unknown'} write: ${writeScope}`));
  }

  let collisions = 0;
  let missingWriteScopes = 0;

  for (const session of unfinished) {
    if (session.writeScope.length === 0) {
      missingWriteScopes += 1;
      console.log(formatStatus('invalid', `${session.id} has no write scope`));
    }
  }

  for (let leftIndex = 0; leftIndex < unfinished.length; leftIndex += 1) {
    const left = unfinished[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < unfinished.length; rightIndex += 1) {
      const right = unfinished[rightIndex];
      for (const leftScope of left.writeScope) {
        const overlappingScope = right.writeScope.find((rightScope) => scopesOverlap(leftScope, rightScope));
        if (!overlappingScope) continue;
        collisions += 1;
        console.log(
          formatStatus(
            'overlap',
            `${left.id} (${normalizeScopePath(leftScope)}) conflicts with ${right.id} (${normalizeScopePath(overlappingScope)})`
          )
        );
        break;
      }
    }
  }

  console.log('');
  if (missingWriteScopes > 0 || collisions > 0) {
    console.log('Result: active sessions need coordination before parallel agent work continues.');
    process.exitCode = 1;
    return;
  }

  if (unfinished.length === 0) {
    console.log('Result: no active sessions.');
    return;
  }

  console.log('Result: active sessions have disjoint write scopes.');
}
