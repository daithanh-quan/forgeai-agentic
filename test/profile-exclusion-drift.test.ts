import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROFILE_EXCLUSIONS } from '../bin/lib/profile-exclusions.js';
import { getAvailableProfiles } from '../bin/lib/profiles.js';

const HEADING = '## Context exclusion hints';
const BULLET = /^- `([^`]+)` — (.+)$/;

function readSection(profile: string): { pattern: string; reason: string }[] | null {
  const p = path.join('profiles', profile, '.ai', 'profiles', `${profile}.md`);
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start === -1) return null;
  const out: { pattern: string; reason: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    const m = line.match(BULLET);
    if (m) out.push({ pattern: m[1], reason: m[2].trim() });
  }
  return out;
}

test('each code-table profile matches its Markdown bullets exactly', () => {
  for (const [profile, rules] of Object.entries(PROFILE_EXCLUSIONS)) {
    const md = readSection(profile);
    assert.ok(md, `profile ${profile} must have a "${HEADING}" section`);
    assert.deepEqual(
      md,
      rules.map((r) => ({ pattern: r.pattern, reason: r.reason })),
      `drift in profile ${profile}`
    );
  }
});

test('profiles without a code table have no exclusion section', () => {
  for (const profile of getAvailableProfiles()) {
    if (PROFILE_EXCLUSIONS[profile]) continue;
    assert.equal(readSection(profile), null, `profile ${profile} must not document exclusions`);
  }
});
