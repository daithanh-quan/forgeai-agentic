# Phase 14 — Upgrade & Release UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add upgrade impact listing (preview + apply), migration note output on upgrade, downgrade protection, and a CI-friendly `--check-upgrade` command. Fix version-string tests to read from `package.json` at every release.

**Architecture:** Add `computeFileAction()` to `init.ts` as a shared content classifier (`create | update | unchanged`) used in both the `--upgrade --dry-run` preview path and the `--upgrade` apply path — so what the preview reports matches exactly what the apply does. Add `upgrade-notes.ts` for version-range migration note collection (pure function, no side effects). Refactor `shouldRunUpdateCheck()` to accept optional flag overrides for deterministic unit testing. Add `runCheckUpgrade()` as a fully offline three-state version check.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, strict), node:fs, node:test (no new runtime dependencies)

## Global Constraints

- No new runtime npm dependencies
- All tests use `node:test` (same pattern as `test/upgrade.test.ts`)
- Version bump to **3.4.0**
- `docs/migrations` is already in `package.json` `files` — no change needed
- Migration docs live at `docs/migrations/X.Y.Z.md`; resolved at runtime via `path.resolve(__dirname, '../../docs/migrations')` from compiled `dist/lib/`
- Evaluation run records are currently `.md` files (`bin/lib/evaluation.ts:44`); JSON is a future Phase 13 schema
- `relativePath` in all log output uses `/` separator (`path.relative(...).split(path.sep).join('/')`) for cross-platform consistency

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `bin/lib/init.ts` | Modify | `computeFileAction()` (shared classifier); upgrade-aware preview + apply output; downgrade guard in `runInit()` |
| `bin/lib/upgrade-notes.ts` | Create | Pure `collectMigrationNotes()` + `printMigrationNotes()` |
| `bin/lib/update-check.ts` | Modify | `runCheckUpgrade()` (three-state, offline); `shouldRunUpdateCheck()` accepts optional overrides; exclude `--check-upgrade` from npm preflight |
| `bin/lib/context.ts` | Modify | Add `checkUpgrade` flag |
| `bin/forgeai-init.ts` | Modify | Wire `--check-upgrade` → `runCheckUpgrade()` |
| `test/upgrade.test.ts` | Modify | Tests for all deliverables |
| `test/dist.test.ts` | Modify | Smoke tests for `--check-upgrade` and migration notes in compiled CLI |
| `test/lifecycle.test.ts` | Modify | Replace hard-coded `3.3.0` with `CURRENT_VERSION` from `package.json` |
| `test/profile.test.ts` | Modify | Replace hard-coded `3.3.0` with `CURRENT_VERSION` from `package.json` |
| `README.md` | Modify | Section explaining `--check-updates` vs `--check-upgrade` with CI example |
| `docs/migrations/3.4.0.md` | Create | Migration guide for this release |
| `CHANGELOG.md` | Modify | Add 3.4.0 section |
| `package.json` | Modify | Bump version to 3.4.0 |
| `package-lock.json` | Modify | Sync to 3.4.0 (`npm version 3.4.0 --no-git-tag-version`) |
| `docs/superpowers/plans/2026-07-16-phase-14-upgrade-release-ux.md` | Create | This plan document |

---

## Task 0: Commit the plan

Commit the plan file before any implementation so it is part of the Git history
and the working tree is clean for subsequent steps.

- [ ] **Step 1: Commit the plan**

```bash
git add docs/superpowers/plans/2026-07-16-phase-14-upgrade-release-ux.md
git commit -m "docs: add Phase 14 upgrade and release UX implementation plan"
```

---

## Task 1: Regression test — evaluation run records survive upgrade

User-created eval records (`.ai/evaluation/run-001.md`) are not in `templates/`,
so `copyRecursive()` never traverses them. No implementation change needed.
These tests document the guarantee.

**Files:**
- Test: `test/upgrade.test.ts`

- [ ] **Step 1: Write the regression tests**

Add to `test/upgrade.test.ts`:

```typescript
test('upgrade does not touch user-created evaluation run records', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-eval-'));
  try {
    runTs(cli, [], { cwd: target });

    const evalDir = path.join(target, '.ai', 'evaluation');
    fs.mkdirSync(evalDir, { recursive: true });
    const evalFile = path.join(evalDir, 'run-001.md');
    fs.writeFileSync(evalFile, '# Run 001\n\n- Run ID: run-001\n- Outcome: pass\n');

    runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(fs.readFileSync(evalFile, 'utf8'), /run-001/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade --force does not touch user-created evaluation run records', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-eval-force-'));
  try {
    runTs(cli, [], { cwd: target });

    const evalDir = path.join(target, '.ai', 'evaluation');
    fs.mkdirSync(evalDir, { recursive: true });
    const evalFile = path.join(evalDir, 'run-001.md');
    fs.writeFileSync(evalFile, '# Run 001\n\n- Run ID: run-001\n- Outcome: pass\n');

    runTs(cli, ['--upgrade', '--force'], { cwd: target });

    assert.match(fs.readFileSync(evalFile, 'utf8'), /run-001/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests — both pass immediately (existing guarantee)**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|evaluation run"
```

Expected: both pass

- [ ] **Step 3: Commit**

```bash
git add test/upgrade.test.ts
git commit -m "test(upgrade): document evaluation run record preservation guarantee"
```

---

## Task 2: Upgrade impact listing — consistent preview and apply output

Add `computeFileAction()` as a shared classifier. Use it in **both** the preview
(`--upgrade --dry-run`) and the apply (`--upgrade`) paths so their messages match:

| `computeFileAction()` result | Preview output | Apply output |
|------------------------------|----------------|--------------|
| `create` | `would create X` | `created X` |
| `update` | `would update X` | `updated X` |
| `unchanged` | `no change X` | `no change X` (skips copy) |

The `preserved` path (handled by the existing `isPreservedOnUpgrade()` guard before
this block) and the non-upgrade `--dry-run` path are unchanged.

**Files:**
- Modify: `bin/lib/init.ts`
- Test: `test/upgrade.test.ts`

**Interfaces:**
- Produces: `export function computeFileAction(src: string, dest: string): 'create' | 'update' | 'unchanged'`

- [ ] **Step 1: Write the failing tests**

Add to `test/upgrade.test.ts`:

```typescript
// --- Preview path ---

test('--upgrade --dry-run reports "would update" for managed files with changed content', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-preview-update-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, fs.readFileSync(agentPath, 'utf8') + '\nSTALE_MARKER\n');

    const output = runTs(cli, ['--upgrade', '--dry-run'], { cwd: target });

    assert.match(output, /would update \.ai\/agents\/orchestrator\.md/);
    // Dry run must not modify anything
    assert.match(fs.readFileSync(agentPath, 'utf8'), /STALE_MARKER/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --dry-run reports "no change" for managed files already up-to-date', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-preview-nochange-'));
  try {
    runTs(cli, [], { cwd: target });
    const output = runTs(cli, ['--upgrade', '--dry-run'], { cwd: target });

    assert.match(output, /no change/);
    assert.doesNotMatch(output, /would update/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Apply path ---

test('--upgrade logs "updated" and overwrites managed files with changed content', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-update-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, fs.readFileSync(agentPath, 'utf8') + '\nSTALE_MARKER\n');

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /updated \.ai\/agents\/orchestrator\.md/);
    assert.doesNotMatch(fs.readFileSync(agentPath, 'utf8'), /STALE_MARKER/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade logs "no change" and skips copy for managed files already up-to-date', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-nochange-'));
  try {
    runTs(cli, [], { cwd: target });
    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /no change/);
    assert.doesNotMatch(output, /\bupdated\b/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade creates a missing managed file and logs "created"', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-create-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.rmSync(agentPath);

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /created \.ai\/agents\/orchestrator\.md/);
    assert.ok(fs.existsSync(agentPath));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify the right subset fails**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|preview|apply|would update|no change"
```

Expected: the four preview/update/no-change tests fail; the `create` regression test passes
(the current implementation already copies missing files and logs "created")

- [ ] **Step 3: Add `computeFileAction()` and update the final block of `copyRecursive()` in `bin/lib/init.ts`**

Add the helper before `copyRecursive` (no new imports needed):

```typescript
export function computeFileAction(src: string, dest: string): 'create' | 'update' | 'unchanged' {
  if (!fs.existsSync(dest)) return 'create';
  return fs.readFileSync(src).equals(fs.readFileSync(dest)) ? 'unchanged' : 'update';
}
```

Also normalize `relativePath` in the existing `preserved` and `skip` log lines inside
`copyRecursive` (find every `path.relative(root, dest)` call and append `.split(path.sep).join('/')`):

```typescript
// preserved line — was:
console.log(`preserved ${path.relative(root, dest)}`);
// becomes:
console.log(`preserved ${path.relative(root, dest).split(path.sep).join('/')}`);

// skip line — was:
console.log(`skip ${path.relative(root, dest)} already exists. Use --force or --upgrade to overwrite.`);
// becomes:
console.log(`skip ${path.relative(root, dest).split(path.sep).join('/')} already exists. Use --force or --upgrade to overwrite.`);
```

Replace the final block of `copyRecursive` (everything after the guard `return`s):

Old:
```typescript
  if (dryRun) console.log(`would create ${path.relative(root, dest)}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`created ${path.relative(root, dest)}`);
  }
```

New:
```typescript
  const relativePath = path.relative(root, dest).split(path.sep).join('/');

  if (upgrade) {
    const action = computeFileAction(src, dest);
    if (dryRun) {
      if (action === 'unchanged') console.log(`no change ${relativePath}`);
      else console.log(`would ${action} ${relativePath}`);
      return;
    }
    if (action === 'unchanged') {
      console.log(`no change ${relativePath}`);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`${action === 'update' ? 'updated' : 'created'} ${relativePath}`);
    return;
  }

  if (dryRun) {
    console.log(`would create ${relativePath}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`created ${relativePath}`);
```

- [ ] **Step 4: Run tests to verify all five pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|preview|apply|would update|no change"
```

Expected:
```
✓ --upgrade --dry-run reports "would update" for managed files with changed content
✓ --upgrade --dry-run reports "no change" for managed files already up-to-date
✓ --upgrade logs "updated" and overwrites managed files with changed content
✓ --upgrade logs "no change" and skips copy for managed files already up-to-date
✓ --upgrade creates a missing managed file and logs "created"
```

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add bin/lib/init.ts test/upgrade.test.ts
git commit -m "feat(upgrade): consistent create/update/no-change output in preview and apply paths"
```

---

## Task 3: Migration notes — print relevant docs after upgrade; block downgrade

Two deliverables in one task because both depend on reading `installedVersion` at the
start of `runInit()`.

`collectMigrationNotes` contract (pure function):
- `toVersion` invalid → `[]`
- `fromVersion === null` OR invalid (not parseable) → return only the note for exactly `toVersion` if it exists
- `fromVersion >= toVersion` (same or downgrade) → `[]`
- Normal range → notes for all versions `> fromVersion` and `<= toVersion`, sorted ascending

**Files:**
- Create: `bin/lib/upgrade-notes.ts`
- Modify: `bin/lib/init.ts`
- Test: `test/upgrade.test.ts`

**Interfaces:**
- `collectMigrationNotes(fromVersion: string | null, toVersion: string, migrationsDir?: string): string[]`
- `printMigrationNotes(notes: string[]): void`

- [ ] **Step 1: Write the failing tests**

Add import at top of `test/upgrade.test.ts`:
```typescript
import { collectMigrationNotes } from '../bin/lib/upgrade-notes.js';
```

Add tests:

```typescript
test('collectMigrationNotes returns notes strictly newer than fromVersion', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-range-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.2.0.md'), '# Migration 3.2.0\nNotes A.');
    fs.writeFileSync(path.join(tempDir, '3.3.0.md'), '# Migration 3.3.0\nNotes B.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes C.');

    const notes = collectMigrationNotes('3.2.0', '3.4.0', tempDir);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /3\.3\.0/);
    assert.match(notes[1], /3\.4\.0/);
    assert.doesNotMatch(notes.join('\n'), /3\.2\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes with null fromVersion returns only the toVersion note', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-null-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.2.0.md'), '# Migration 3.2.0\nOld notes.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nLatest notes.');

    const notes = collectMigrationNotes(null, '3.4.0', tempDir);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /3\.4\.0/);
    assert.doesNotMatch(notes[0], /3\.2\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes with invalid fromVersion returns only the toVersion note', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-invalid-from-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.3.0.md'), '# Migration 3.3.0\nNotes.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nLatest.');

    const notes = collectMigrationNotes('unknown', '3.4.0', tempDir);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /3\.4\.0/);
    assert.doesNotMatch(notes.join('\n'), /3\.3\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes returns empty array for downgrade or same version', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-downgrade-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes.');

    assert.deepEqual(collectMigrationNotes('3.4.0', '3.4.0', tempDir), []);
    assert.deepEqual(collectMigrationNotes('4.0.0', '3.4.0', tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes returns empty array when toVersion is invalid', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-badto-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes.');

    assert.deepEqual(collectMigrationNotes('3.3.0', 'unknown', tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('--upgrade prints migration notes when harness version is older than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-notes-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '3.2.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /Migration notes/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade refuses to downgrade the harness', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-downgrade-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '99.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Stale a managed file to prove the guard runs before any file mutation
    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, 'LOCAL CONTENT\n');

    let combined = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      combined = String((error as ExecError).stdout ?? '') + String((error as ExecError).stderr ?? '');
    }
    assert.match(combined, /refusing downgrade/i);
    assert.match(fs.readFileSync(manifestPath, 'utf8'), /99\.0\.0/);
    assert.equal(fs.readFileSync(agentPath, 'utf8'), 'LOCAL CONTENT\n');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|migration|downgrade|notes"
```

Expected: all new tests fail (module not found; downgrade not blocked)

- [ ] **Step 3: Create `bin/lib/upgrade-notes.ts`**

```typescript
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
```

- [ ] **Step 4: Update `runInit()` in `bin/lib/init.ts`**

Add imports:
```typescript
import { compareSemver, getPackageVersion, parseSemver } from './utils.js';
import { collectMigrationNotes, printMigrationNotes } from './upgrade-notes.js';
```

Replace the first line of `runInit()` and add the downgrade guard:

```typescript
export function runInit(): void {
  const manifest = readManifest();
  const manifestProfile = manifest?.profile;
  const installedVersion = upgrade ? (manifest?.package_version ?? null) : null;
  const currentVersion = getPackageVersion();

  if (
    upgrade &&
    installedVersion &&
    parseSemver(installedVersion) &&
    parseSemver(currentVersion) &&
    compareSemver(installedVersion, currentVersion) > 0
  ) {
    console.error(
      `refusing downgrade: harness ${installedVersion} > CLI ${currentVersion}. ` +
      `Use a CLI version equal to or newer than the installed harness.`
    );
    process.exitCode = 1;
    return;
  }

  const profile = resolveProfile(upgrade ? (manifestProfile ?? requestedProfile) : requestedProfile);
  if (profile.status === 'invalid') {
    console.error(profile.detail);
    process.exitCode = 1;
    return;
  }
  copyRecursive(templateDir, root);
  if (profile.status === 'ok') {
    copyRecursive(profilePath(profile.profile), root);
  } else if (requestedProfile === 'auto' && profile.status === 'unknown') {
    console.log(`profile auto skipped: ${profile.detail}`);
  }
  writeManifest(profile.profile);
  warnMonorepoSecondaryStack(profile.profile);
  maintainContextGitignore(root, dryRun);
  console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');

  if (upgrade && !dryRun) {
    const notes = collectMigrationNotes(installedVersion, currentVersion);
    printMigrationNotes(notes);
  }
}
```

> The old `const manifestProfile = readManifest()?.profile;` is replaced by the first three lines. The rest of `runInit()` is identical to the current version except for the downgrade guard and the migration-notes call at the end.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|migration|downgrade|notes"
```

Expected:
```
✓ collectMigrationNotes returns notes strictly newer than fromVersion
✓ collectMigrationNotes with null fromVersion returns only the toVersion note
✓ collectMigrationNotes with invalid fromVersion returns only the toVersion note
✓ collectMigrationNotes returns empty array for downgrade or same version
✓ collectMigrationNotes returns empty array when toVersion is invalid
✓ --upgrade prints migration notes when harness version is older than CLI
✓ --upgrade refuses to downgrade the harness
```

- [ ] **Step 6: Add migration-notes dist smoke test to `test/dist.test.ts`**

The migration-notes feature is now compiled into the dist. Add a smoke test that
verifies the compiled CLI finds `docs/migrations/` relative to its own location:

```typescript
test('compiled dist CLI reads migration docs from docs/migrations/', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-notes-'));
  try {
    runDist([], target);

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { package_version: string };
    manifest.package_version = '3.2.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const output = runDist(['--upgrade'], target);
    assert.match(output, /Migration notes/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

Run to verify it passes (no need for RED step — this is a dist-layer smoke test for an
already-passing unit feature):

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm run build && node --import tsx --test test/dist.test.ts 2>&1 | grep -E "✓|✗|migration"
```

Expected: `✓ compiled dist CLI reads migration docs from docs/migrations/`

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add bin/lib/upgrade-notes.ts bin/lib/init.ts test/upgrade.test.ts test/dist.test.ts
git commit -m "feat(upgrade): print migration notes after upgrade; block downgrade"
```

---

## Task 4: CI upgrade check — `--check-upgrade`

Three distinct exit states:

| State | Condition | Exit |
|-------|-----------|------|
| ok | `installed === cli` | 0 |
| outdated | `installed < cli` | 1 |
| cli-too-old | `installed > cli` | 1 |

Guards (exit 1 with message): no manifest, invalid CLI version, missing `package_version`,
invalid `package_version`, wrong `package` field.

Refactor `shouldRunUpdateCheck()` to accept `overrides?: { checkUpgrade?: boolean; interactive?: boolean; ci?: boolean }` for
unit-testable exclusion verification — current callers pass no args and are unaffected.
The `interactive` and `ci` overrides let tests simulate a real TTY session outside CI
so that a missing `checkUpgrade` condition causes the assertion to fail (in the real test
environment, `isInteractiveTerminal()` is false and `CI` may be `'true'`, so either
short-circuit alone would mask a missing condition).

Dist tests are in this task (not Task 6) because the deliverable — `--check-upgrade` on
the compiled CLI — belongs here. Write them first for RED → GREEN.

**Files:**
- Modify: `bin/lib/update-check.ts`
- Modify: `bin/lib/context.ts`
- Modify: `bin/forgeai-init.ts`
- Modify: `bin/lib/init.ts` (usage string)
- Test: `test/upgrade.test.ts`
- Test: `test/dist.test.ts`

**Interfaces:**
- `runCheckUpgrade(): void`
- `shouldRunUpdateCheck(overrides?: { checkUpgrade?: boolean; interactive?: boolean; ci?: boolean }): boolean`

- [ ] **Step 1: Write all tests (unit, integration, dist)**

Add import at top of `test/upgrade.test.ts`:
```typescript
import { shouldRunUpdateCheck } from '../bin/lib/update-check.js';
```

Add to `test/upgrade.test.ts`:

```typescript
test('shouldRunUpdateCheck skips npm preflight for --check-upgrade even in an interactive TTY outside CI', () => {
  // Pass interactive: true and ci: false to simulate a real non-CI TTY session.
  // Without these overrides, isInteractiveTerminal() is false and CI may be true in the
  // test runner, so a missing checkUpgrade condition would still produce false — a false-negative.
  assert.equal(shouldRunUpdateCheck({ checkUpgrade: true, interactive: true, ci: false }), false);
});

test('--check-upgrade exits 0 when harness version matches CLI version', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-ok-'));
  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check-upgrade'], { cwd: target });

    assert.match(output, /\bok\b/i);
    assert.match(output, /harness.*matches CLI/i);
    // Must not have fallen through to runInit()
    assert.doesNotMatch(output, /initialized/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 and reports outdated when harness version is older than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-old-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '1.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /outdated/i);
    assert.match(output, /1\.0\.0/);
    assert.doesNotMatch(output, /cli.too.old/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 and reports cli-too-old when harness version is newer than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-cli-old-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '99.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /cli.too.old/i);
    assert.match(output, /99\.0\.0/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when no harness is installed', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-none-'));
  try {
    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /no harness installed/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is invalid', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-bad-ver-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = 'not-a-version';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-missing-ver-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.package_version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest belongs to a different package', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-foreign-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package = 'some-other-package';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

Add to `test/dist.test.ts` (after the existing tests):

```typescript
test('compiled dist CLI help contains --check-upgrade', () => {
  const output = runDist(['--help'], projectRoot);
  assert.match(output, /--check-upgrade/);
});

test('compiled dist CLI --check-upgrade exits 0 on a fresh install', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-cu-'));
  try {
    runDist([], target);

    const output = runDist(['--check-upgrade'], target);

    assert.match(output, /\bok\b/i);
    assert.match(output, /harness.*matches CLI/i);
    assert.doesNotMatch(output, /initialized/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

> Note: the migration-notes dist smoke test was added in Task 3 Step 6 (where the feature
> was implemented) and does not need repeating here.

- [ ] **Step 2: Run to verify tests fail (build is from before this task)**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|check-upgrade|shouldRunUpdate"
node --import tsx --test test/dist.test.ts 2>&1 | grep -E "✓|✗|check-upgrade"
```

Expected: new `--check-upgrade` tests in `upgrade.test.ts` fail; `dist.test.ts` `--check-upgrade` tests fail (command not in compiled dist yet)

- [ ] **Step 3: Add `checkUpgrade` to `bin/lib/context.ts`**

After the `checkUpdates` line:
```typescript
export const checkUpgrade = args.has('--check-upgrade');
```

- [ ] **Step 4: Update `bin/lib/update-check.ts`**

Update imports:
```typescript
import { root, packageName, skipUpdateCheck, help, version, listProfiles, checkUpdates, checkUpgrade } from './context.js';
import { getPackageVersion, getLatestPackageVersion, compareSemver, parseSemver, formatStatus } from './utils.js';
import { readManifest } from './manifest.js';
```

Replace `shouldRunUpdateCheck` signature and add `checkUpgrade` exclusion:
```typescript
export function shouldRunUpdateCheck(overrides?: { checkUpgrade?: boolean; interactive?: boolean; ci?: boolean }): boolean {
  const checkingUpgrade = overrides?.checkUpgrade ?? checkUpgrade;
  const interactive = overrides?.interactive ?? isInteractiveTerminal();
  const runningInCi = overrides?.ci ?? process.env.CI === 'true';
  if (skipUpdateCheck) return false;
  if (help || version || listProfiles || checkingUpgrade) return false;
  if (runningInCi) return false;
  if (!checkUpdates && !interactive && !process.env.FORGEAI_TEST_LATEST_VERSION) return false;
  return true;
}
```

The call in `runUpdatePreflight()` passes no args and stays compatible.

Add `runCheckUpgrade()` after `runUpdatePreflight`:
```typescript
export function runCheckUpgrade(): void {
  const currentVersion = getPackageVersion();
  const manifest = readManifest();

  if (!manifest) {
    console.log('no harness installed. Run forgeai-init to install.');
    process.exitCode = 1;
    return;
  }

  if (!parseSemver(currentVersion)) {
    console.log(`cannot determine CLI version: "${currentVersion}"`);
    process.exitCode = 1;
    return;
  }

  if (manifest.package !== packageName) {
    console.log(`invalid manifest package: "${manifest.package}" (expected "${packageName}")`);
    process.exitCode = 1;
    return;
  }

  const installedVersion = manifest.package_version;
  if (!parseSemver(installedVersion)) {
    console.log(`invalid manifest package_version: "${installedVersion ?? 'undefined'}"`);
    process.exitCode = 1;
    return;
  }

  const comparison = compareSemver(installedVersion, currentVersion);

  if (comparison === 0) {
    console.log(formatStatus('ok', `harness ${installedVersion} matches CLI ${currentVersion}`));
    return;
  }

  if (comparison < 0) {
    console.log(formatStatus('outdated', `harness ${installedVersion} < CLI ${currentVersion}`));
    console.log(`Run: npx ${packageName}@${currentVersion} --upgrade`);
    process.exitCode = 1;
    return;
  }

  console.log(formatStatus('cli-too-old', `harness ${installedVersion} > CLI ${currentVersion}`));
  console.log('The installed harness is newer than this CLI. Use a newer CLI version.');
  process.exitCode = 1;
}
```

- [ ] **Step 5: Wire `--check-upgrade` in `bin/forgeai-init.ts`**

Add `checkUpgrade` to the context import and `runCheckUpgrade` to the update-check import:
```typescript
import { ..., expandContext, checkUpgrade } from './lib/context.js';
import { runUpdatePreflight, runCheckUpgrade } from './lib/update-check.js';
```

Add handler before the final `else runInit()`:
```typescript
else if (checkUpgrade) runCheckUpgrade();
else runInit();
```

- [ ] **Step 6: Add `--check-upgrade` to `usage()` in `bin/lib/init.ts`**

After `--check-updates` in the command list:
```
  forgeai-init --check-upgrade
```

After the `--check-updates` option description:
```
  --check-upgrade
                Compare the installed harness version (.ai/manifest.json
                package_version) to the running CLI version. Outcomes: ok
                (match, exits 0), outdated (harness older, exits 1),
                cli-too-old (harness newer, exits 1). No network access —
                suitable for CI use.
```

- [ ] **Step 7: Rebuild and run all tests**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -30
```

Expected: all tests pass (including the dist tests which now rebuild from the new source)

- [ ] **Step 8: Commit**

```bash
git add bin/lib/context.ts bin/lib/update-check.ts bin/forgeai-init.ts bin/lib/init.ts \
        test/upgrade.test.ts test/dist.test.ts
git commit -m "feat(upgrade): add --check-upgrade for offline CI harness version check"
```

---

## Task 5: README documentation

Lands before the version-bump commit so the release commit is complete.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the current upgrade/check-updates section**

```bash
grep -n "check-updates\|upgrade\|Upgrade" README.md | head -20
```

- [ ] **Step 2: Add the upgrade commands section**

After the section that mentions `--check-updates` or upgrade behavior, insert:

```markdown
### Upgrade commands

| Command | When to use |
|---------|-------------|
| `--check-updates` | Interactive local check. Queries npm for the latest version and offers an upgrade prompt. Skipped automatically in CI. |
| `--check-upgrade` | CI-safe offline check. Compares the harness version in `.ai/manifest.json` to the running CLI version. No network access. |

**CI example** — enforce a specific CLI version in your pipeline:

```bash
npx forgeai-agentic-init@3.4.0 --check-upgrade
```

Exits 0 when the installed harness matches the CLI version; exits 1 when
outdated (`harness < CLI`) or when the CLI is older than the installed harness
(`cli-too-old`). Does not check npm or the latest published version.
```

- [ ] **Step 3: Verify section renders**

```bash
grep -A 16 "Upgrade commands" README.md
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add --check-upgrade CI usage section to README"
```

---

## Task 6: Version bump, test fixes, migration doc, changelog

**Files:**
- Modify: `test/lifecycle.test.ts`
- Modify: `test/profile.test.ts`
- Modify: `package.json` + `package-lock.json`
- Create: `docs/migrations/3.4.0.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Replace hard-coded version strings in lifecycle and profile tests**

Verify the exact lines:
```bash
grep -n "3\.3\.0" test/lifecycle.test.ts test/profile.test.ts
```

In `test/lifecycle.test.ts`, after the existing imports add:
```typescript
const CURRENT_VERSION = (
  JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string }
).version;
```

Replace each `'3.3.0'` version assertion:
```typescript
// Line 103 — manifest package_version assertion
assert.equal(manifest.package_version, CURRENT_VERSION);

// Line 132 — --version output assertion
assert.equal(versionOutput.trim(), CURRENT_VERSION);

// Line 269 — manifest package_version assertion after upgrade
assert.equal(manifest.package_version, CURRENT_VERSION);
```

In `test/profile.test.ts`, add the same `CURRENT_VERSION` constant (ensure `fs`, `path`,
and `projectRoot` are already imported from `./helpers.js`) and replace `'3.3.0'` on
line 19 with `CURRENT_VERSION`.

- [ ] **Step 2: Verify tests pass before the version bump (CURRENT_VERSION still reads 3.3.0)**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/lifecycle.test.ts test/profile.test.ts 2>&1 | grep -E "✓|✗"
```

Expected: all pass

- [ ] **Step 3: Bump version**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm version 3.4.0 --no-git-tag-version
```

Verify both files updated:
```bash
grep '"version"' package.json
grep "3\.3\.0" package-lock.json
```

Expected: `"version": "3.4.0"` in package.json; no `3.3.0` in package-lock.json.

- [ ] **Step 4: Create `docs/migrations/3.4.0.md`**

```markdown
# Migration Guide — 3.4.0

## What changed

- `--upgrade --dry-run` now classifies each managed file as `no change`,
  `would update`, or `would create` using pure Node content comparison (no
  external binary). The real apply path uses the same classifier, so preview
  and apply output always match.

- `--upgrade` now skips unchanged managed files (no copy, `no change` log)
  and logs `updated` instead of `created` when it overwrites a changed file.

- `--upgrade` refuses to downgrade the harness. If the installed harness
  version is newer than the running CLI, the command exits 1 with:
  `refusing downgrade: harness X > CLI Y. Use a CLI version equal to or newer
  than the installed harness.`

- `--upgrade` prints relevant migration notes after a successful update. Notes
  are read from `docs/migrations/` and filtered to the installed-to-current
  version range. First installs and manifests without a valid `package_version`
  see only the current version's note.

- `--check-upgrade` is a new command that compares the installed harness version
  (`package_version` in `.ai/manifest.json`) to the running CLI version. Three
  outcomes: `ok` (match, exits 0), `outdated` (harness older, exits 1),
  `cli-too-old` (harness newer, exits 1). Also validates manifest package
  identity. No network access — suitable for CI use.

- Evaluation run records (`.ai/evaluation/*.md`) are safe from upgrade overwrites
  because they are user-created files, not package templates. This guarantee is
  now covered by regression tests.

## Upgrade steps

Run `forgeai-init --upgrade`. No schema changes or manual harness-file edits are
required. Note that `--upgrade` now refuses downgrades when the installed harness
is newer than the running CLI.
```

- [ ] **Step 5: Add 3.4.0 entry to `CHANGELOG.md`**

Prepend before the existing `## 3.3.0` line:

```markdown
## 3.4.0 — 2026-07-16

### Added

- `--check-upgrade` command: offline three-state harness version check (`ok` /
  `outdated` / `cli-too-old`). Validates manifest package identity and version
  format. No network access — designed for CI use.
- `--upgrade --dry-run` now classifies managed files as `no change`, `would
  update`, or `would create`. The real apply path uses the same classifier —
  what the preview reports is what the apply does.
- `--upgrade` now logs `updated` (not `created`) when overwriting changed
  managed files, and skips unchanged files entirely (`no change`).
- `--upgrade` refuses to downgrade the harness and exits 1 with a clear message.
- `--upgrade` prints migration notes filtered to the installed-to-current
  version range after a successful update.

### Changed

- Version assertions in `test/lifecycle.test.ts` and `test/profile.test.ts` now
  read from `package.json` dynamically — version bumps no longer require manual
  test edits.
- Upgrade file-operation log paths are normalized to `/` on all platforms.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.4.0.md`.

```

- [ ] **Step 6: Run the full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -30
```

Expected: all tests pass with version 3.4.0

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json \
        test/lifecycle.test.ts test/profile.test.ts \
        docs/migrations/3.4.0.md CHANGELOG.md
git commit -m "chore: release 3.4.0 — upgrade & release UX (Phase 14)"
```

---

## Self-Review

**Spec coverage:**

| Deliverable | Task | Notes |
|-------------|------|-------|
| Preview managed-file changes before overwrite | Task 2 | Consistent preview + apply via shared `computeFileAction()` |
| Changelog and migration notes | Task 3 + Task 6 | Range-aware, edge-case-hardened, pure collector |
| Schema migrations | — | Deferred per ROADMAP: "land alongside schemas they migrate" |
| Preserve project-owned run state | Task 1 | Regression tests; user-created files never traversed by `copyRecursive()` |
| Opt-in CI upgrade checks; never silently rewrite | Task 4 | Offline three-state; excluded from npm preflight; unit test verifies exclusion regardless of TTY state |
| Downgrade protection | Task 3 | Guard runs before any file copy; managed-file assertion confirms nothing was mutated |
| Documentation | Task 5 | README CI example; clear `--check-updates` vs `--check-upgrade` distinction |

**Placeholder scan:** No TBD, TODO, or vague instructions. All code steps include actual code.

**Type consistency:**
- `computeFileAction(src: string, dest: string): 'create' | 'update' | 'unchanged'` — same type used in `copyRecursive()` upgrade block (both preview and apply branches)
- `collectMigrationNotes(fromVersion: string | null, toVersion: string, migrationsDir?: string): string[]` — consistent across `upgrade-notes.ts`, import in tests, and `runInit()` call
- `printMigrationNotes(notes: string[]): void` — consistent across module and `runInit()` call
- `shouldRunUpdateCheck(overrides?: { checkUpgrade?: boolean; interactive?: boolean; ci?: boolean }): boolean` — `runUpdatePreflight()` passes no override and keeps existing behavior; test passes `{ checkUpgrade: true, interactive: true, ci: false }` to verify npm preflight is skipped even in a real TTY outside CI
- `runCheckUpgrade(): void` — consistent across implementation, import, and dispatch in `forgeai-init.ts`
- `checkUpgrade: boolean` — exported from `context.ts`; imported in `update-check.ts` and `forgeai-init.ts`
