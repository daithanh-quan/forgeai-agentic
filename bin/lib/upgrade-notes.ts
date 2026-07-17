import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSemver, parseSemver } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultMigrationsDir = path.resolve(__dirname, '../../docs/migrations');

export function collectMigrationNotes(
  fromVersion: string | null,
  toVersion: string,
  migrationsDir = defaultMigrationsDir
): string[] {
  if (!parseSemver(toVersion)) return [];
  if (!fs.existsSync(migrationsDir)) return [];

  const fromIsValid = fromVersion !== null && parseSemver(fromVersion) !== null;

  if (fromIsValid && compareSemver(fromVersion!, toVersion) >= 0) return [];

  const notes: Array<{ version: string; content: string }> = [];

  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith('.md')) continue;
    const stem = file.slice(0, -3);
    if (!parseSemver(stem)) continue;

    if (fromIsValid) {
      if (compareSemver(stem, fromVersion!) > 0 && compareSemver(stem, toVersion) <= 0) {
        notes.push({ version: stem, content: fs.readFileSync(path.join(migrationsDir, file), 'utf8') });
      }
    } else {
      if (compareSemver(stem, toVersion) === 0) {
        notes.push({ version: stem, content: fs.readFileSync(path.join(migrationsDir, file), 'utf8') });
      }
    }
  }

  notes.sort((a, b) => compareSemver(a.version, b.version));
  return notes.map((n) => n.content);
}

export function printMigrationNotes(notes: string[]): void {
  if (notes.length === 0) return;
  console.log('\nMigration notes:');
  console.log('─'.repeat(60));
  for (const note of notes) {
    console.log(note.trimEnd());
    console.log('─'.repeat(60));
  }
}
