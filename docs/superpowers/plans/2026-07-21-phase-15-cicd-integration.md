# Phase 15 — CI/CD Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a GitHub Actions workflow template (`ci-templates/github/forgeai.yml`) in the npm package with five parallel credential-free check jobs, plus a README section and dist tests.

**Architecture:** A new `ci-templates/github/` directory is added to the repo and listed in `package.json` `files[]` so it ships with the npm package. Users copy the YAML template into their own `.github/workflows/` and replace the `VERSION` placeholder. No CLI changes — existing check commands already exit 1 on failure.

**Tech Stack:** Node.js ≥20, TypeScript, `node:test`, `node:fs`, `node:child_process`, `node:assert/strict`, GitHub Actions YAML

## Global Constraints

- Node.js `>=20.0.0` (matches `engines` in `package.json`)
- No new runtime dependencies
- All check commands already exit with `process.exitCode = 1` on failure — do not add wrapper scripts
- `VERSION` must remain a literal placeholder string (do not substitute a real version)
- Tests use `node:test` + `node:assert/strict` — no Jest, no Mocha
- `projectRoot` helper is already exported from `test/helpers.ts`
- Run tests with: `npm test` (runs typecheck + build + node test runner)
- User commits; do not run `git commit` on their behalf

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `ci-templates/github/forgeai.yml` | GitHub Actions workflow template |
| Modify | `package.json` | Add `"ci-templates"` to `files[]`, bump version to `3.6.0` |
| Modify | `package-lock.json` | Kept in sync by `npm version` command (not hand-edited) |
| Modify | `test/dist.test.ts` | Add file-presence, YAML-structure, and npm-pack tests |
| Modify | `README.md` | Add "CI/CD Integration" section before `## Profiles` |
| Modify | `CHANGELOG.md` | Add `## 3.6.0` entry |

---

### Task 1: Write failing tests

Add three tests to `test/dist.test.ts` before creating the template file, so we can confirm they fail first.

**Files:**
- Modify: `test/dist.test.ts`

**Interfaces:**
- Consumes: `projectRoot` from `./helpers.js` (already imported at top of file); `execFileSync` from `node:child_process` (already imported)
- Produces: three new `test()` blocks that Task 2 will make pass

- [ ] **Step 1: Add the three tests at the bottom of `test/dist.test.ts`**

Open `test/dist.test.ts` and append after the last `test(...)` block:

```ts
test('ci-templates/github/forgeai.yml exists in the package source', () => {
  const templatePath = path.join(projectRoot, 'ci-templates', 'github', 'forgeai.yml');
  assert.ok(fs.existsSync(templatePath), 'ci-templates/github/forgeai.yml must exist');
});

test('ci-templates/github/forgeai.yml has required workflow structure', () => {
  const templatePath = path.join(projectRoot, 'ci-templates', 'github', 'forgeai.yml');
  const content = fs.readFileSync(templatePath, 'utf8');

  // Top-level workflow keys
  assert.ok(content.includes('name: ForgeAI Harness'), 'workflow must have name: ForgeAI Harness');
  assert.ok(content.includes('on:'), 'workflow must have on: trigger');
  assert.ok(content.includes('jobs:'), 'workflow must have a jobs section');

  // All five job IDs
  assert.ok(content.includes('upgrade-check:'), 'workflow must have upgrade-check job');
  assert.ok(content.includes('harness-check:'), 'workflow must have harness-check job');
  assert.ok(content.includes('security:'), 'workflow must have security job');
  assert.ok(content.includes('codegraph:'), 'workflow must have codegraph job');
  assert.ok(content.includes('review:'), 'workflow must have review job');

  // All five commands contain @VERSION (not @latest or a pinned semver)
  assert.ok(content.includes('--check-upgrade'), 'workflow must run --check-upgrade');
  assert.ok(content.includes('--check-security'), 'workflow must run --check-security');
  assert.ok(content.includes('--check-codegraph --strict'), 'codegraph job must use --strict flag');
  assert.ok(content.includes('--check-review'), 'workflow must run --check-review');
  assert.ok(content.match(/npx --yes forgeai-agentic-init@VERSION/g)?.length === 5,
    'all 5 jobs must use npx --yes forgeai-agentic-init@VERSION');

  // No needs: — all jobs must run in parallel
  assert.ok(!content.includes('needs:'), 'workflow must not have needs: (jobs must run in parallel)');

  // Least-privilege permissions
  assert.ok(content.includes('permissions:'), 'workflow must declare permissions');
  assert.ok(content.includes('contents: read'), 'workflow must use contents: read permission');
});

test('ci-templates/github/forgeai.yml is included in the npm package', () => {
  const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-npm-cache-'));
  try {
    const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    });
    const [packResult] = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
    const filePaths = packResult.files.map((f) => f.path);
    assert.ok(
      filePaths.includes('ci-templates/github/forgeai.yml'),
      'ci-templates/github/forgeai.yml must be included in the npm package'
    );
  } finally {
    fs.rmSync(npmCache, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to confirm the three new tests fail**

```bash
npm test 2>&1 | grep -A3 "ci-templates"
```

Expected output: three failures — file not found, content checks fail, and path missing from pack output. All other existing tests should still pass.

---

### Task 2: Create CI template and register in package

**Files:**
- Create: `ci-templates/github/forgeai.yml`
- Modify: `package.json` (`files[]` only — version bumped in Task 4)

**Interfaces:**
- Consumes: nothing from prior tasks at runtime
- Produces: `ci-templates/github/forgeai.yml` (the artifact Task 3 references in README)

- [ ] **Step 1: Create the directory and workflow file**

Create `ci-templates/github/forgeai.yml` with this exact content:

```yaml
name: ForgeAI Harness

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  upgrade-check:
    name: Harness version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx --yes forgeai-agentic-init@VERSION --check-upgrade

  harness-check:
    name: Harness files
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx --yes forgeai-agentic-init@VERSION --check

  security:
    name: Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx --yes forgeai-agentic-init@VERSION --check-security

  codegraph:
    name: CodeGraph
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx --yes forgeai-agentic-init@VERSION --check-codegraph --strict

  review:
    name: Review gates
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx --yes forgeai-agentic-init@VERSION --check-review
```

- [ ] **Step 2: Add `"ci-templates"` to `package.json` `files[]`**

In `package.json`, the `files` array currently reads:
```json
"files": [
  "dist",
  "CHANGELOG.md",
  "docs/assets/banner-readme.png",
  "docs/migrations",
  "profiles",
  "templates",
  "README.md"
]
```

Add `"ci-templates"` so it becomes:
```json
"files": [
  "dist",
  "CHANGELOG.md",
  "ci-templates",
  "docs/assets/banner-readme.png",
  "docs/migrations",
  "profiles",
  "templates",
  "README.md"
]
```

- [ ] **Step 3: Run full test suite to confirm all three new tests pass**

```bash
npm test
```

Expected: all tests pass, including the three new `ci-templates` tests. Zero failures.

- [ ] **Step 4: User commits**

```
feat(ci): add GitHub Actions workflow template

ci-templates/github/forgeai.yml ships five parallel credential-free
check jobs. Users copy the file into .github/workflows/ and replace
VERSION with their harness version.
```

---

### Task 3: Add README section

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `ci-templates/github/forgeai.yml` path (created in Task 2)
- Produces: documented copy instructions for users

- [ ] **Step 1: Locate the correct insertion point in README.md**

The `### Upgrade commands` section ends with this paragraph (just before `## Profiles`):

```
Exits 0 when the installed harness matches the CLI version; exits 1 when
outdated (`harness < CLI`) or when the CLI is older than the installed harness
(`cli-too-old`). Does not check npm or the latest published version.
```

Insert the new section after that paragraph, immediately before `## Profiles`.

- [ ] **Step 2: Insert the "CI/CD Integration" section**

The text to insert between the `### Upgrade commands` closing paragraph and `## Profiles`:

````markdown
## CI/CD Integration

Copy the workflow template into your project:

```bash
mkdir -p .github/workflows
cp node_modules/forgeai-agentic-init/ci-templates/github/forgeai.yml \
   .github/workflows/forgeai.yml
```

Or download a pinned version directly from npm:

```bash
mkdir -p .github/workflows
curl -fsSL \
  https://unpkg.com/forgeai-agentic-init@3.6.0/ci-templates/github/forgeai.yml \
  -o .github/workflows/forgeai.yml
```

Then open `.github/workflows/forgeai.yml` and replace `VERSION` with your
current harness version (found in `.ai/manifest.json`).

The workflow runs five critical gates — **Harness version**, **Harness files**,
**Security**, **CodeGraph**, and **Review gates** — all without provider
credentials.

The template targets `branches: [main]`. If your repository uses `master`,
`develop`, or release branches, update the `on.push.branches` and
`on.pull_request.branches` lists before committing the workflow.

To make any job a required status check, go to **Settings → Branches →
Branch protection rules** and add the job name (e.g. `Harness version`,
`Security`).
````

- [ ] **Step 3: Verify insertion position**

```bash
grep -n "CI/CD Integration\|## Profiles" README.md
```

Expected: `CI/CD Integration` appears on a line immediately before `## Profiles`. Confirm no content from `### Upgrade commands` appears between the two.

- [ ] **Step 4: User commits**

```
docs: add CI/CD Integration section to README

Explains how to copy ci-templates/github/forgeai.yml and pin jobs
as required status checks.
```

---

### Task 4: Bump version and update CHANGELOG

**Files:**
- Modify: `package.json` (version field)
- Modify: `package-lock.json` (kept in sync automatically)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed Tasks 1–3
- Produces: `3.6.0` release entry; `package-lock.json` in sync with `package.json`

- [ ] **Step 1: Bump version using npm (updates both package.json and package-lock.json)**

```bash
npm version 3.6.0 --no-git-tag-version
```

Expected output: `v3.6.0`. This updates `"version"` in both `package.json` and the two occurrences in `package-lock.json` atomically. Do not hand-edit the version fields.

- [ ] **Step 2: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, before the `## 3.5.0` block, add:

```markdown
## 3.6.0 — 2026-07-21

### Added

- **CI/CD Integration** (Phase 15): `ci-templates/github/forgeai.yml` ships
  in the npm package — a GitHub Actions workflow with five critical gates
  (`upgrade-check`, `harness-check`, `security`, `codegraph`, `review`).
  Copy into `.github/workflows/`, replace `VERSION` with your harness version
  from `.ai/manifest.json`. No provider credentials required.
  See [CI/CD Integration](README.md#cicd-integration) in the README.

```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass. Zero failures.

- [ ] **Step 4: Verify version output**

```bash
node dist/forgeai-init.js --version
```

Expected output: `3.6.0`

- [ ] **Step 5: Verify npm pack includes the template**

```bash
CACHE=$(mktemp -d) && \
npm_config_cache="$CACHE" npm pack --dry-run --json | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const f=JSON.parse(d)[0].files.map(x=>x.path);
const ok=f.includes('ci-templates/github/forgeai.yml');
console.log(ok ? 'PASS: template in package' : 'FAIL: template missing');
process.exitCode = ok ? 0 : 1;
" ; rm -rf "$CACHE"
```

Expected output: `PASS: template in package` with exit code 0.

- [ ] **Step 6: User commits**

```
chore: release 3.6.0 — CI/CD integration (Phase 15)
```
