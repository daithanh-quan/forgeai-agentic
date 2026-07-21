---
name: phase-15-cicd-integration
description: Design spec for Phase 15 — CI/CD integration via GitHub Actions workflow template with parallel credential-free check jobs
metadata:
  type: project
---

# Phase 15 — CI/CD Integration

## Background

Phase 14 shipped upgrade UX and `--check-upgrade` for CI. Phase 16 shipped stack profiles. Phase 15 closes the adoption loop by giving teams a ready-to-use GitHub Actions workflow that enforces five critical gates on every PR — no provider credentials required.

## Scope

**In scope:**
- One GitHub Actions workflow template (`ci-templates/github/forgeai.yml`) shipped in the npm package
- Five parallel check jobs: `upgrade-check`, `harness-check`, `security`, `codegraph`, `review`
- README section "CI/CD Integration" with copy instructions
- `dist.test.ts` assertion that the template file is present in the package
- Basic YAML structure validation in tests

**Out of scope (deferred):**
- GitLab CI templates (Phase 15.1)
- Adapter integration tests requiring CI secrets (depends on Phase 12)
- `--init-ci` CLI command (not needed; file-in-package approach chosen)
- Composite GitHub Actions (over-engineering for ~5 checks)

## Package Structure

```
ci-templates/
  github/
    forgeai.yml
```

Added to `package.json` `files[]`:
```json
"ci-templates"
```

`ci-templates/` is not a managed harness file — it is not installed into `.ai/` and is not tracked by the upgrade system. It is a one-time copy template owned by the user after copying.

## Workflow Design

File: `ci-templates/github/forgeai.yml`

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

**Key decisions:**
- `VERSION` is a literal placeholder — user replaces with their harness version (e.g. `3.6.0`), found in `.ai/manifest.json`. `@latest` is explicitly avoided to prevent silent breaking changes in CI.
- `node-version: '20'` matches `engines.node >= 20` in `package.json`.
- All five jobs run in parallel (`needs:` is absent by design).
- All check commands already set `process.exitCode = 1` on failure — no wrapper script needed.
- `upgrade-check` detects when the team bumps the `VERSION` pin in the workflow but forgets to run `--upgrade` in the repo; it fails with a clear message pointing to the fix command.
- `permissions: contents: read` applies least-privilege at the workflow level.
- `--yes` on all `npx` calls ensures non-interactive package download in CI.
- `--check-codegraph --strict` promotes CodeGraph warnings to errors in CI.

## README Section

New section added after "Upgrade commands":

```markdown
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
```

## Testing

Three tests are added to `test/dist.test.ts`:

**1. Source presence** — asserts the file exists in the package source tree:
```ts
assert.ok(fs.existsSync(path.join(projectRoot, 'ci-templates', 'github', 'forgeai.yml')),
  'ci-templates/github/forgeai.yml must exist');
```

**2. YAML structure** — asserts required keys, all five job IDs, all five `npx --yes forgeai-agentic-init@VERSION` invocations, `--check-codegraph --strict`, absence of `needs:`, and `permissions: contents: read`.

**3. npm pack inclusion** — asserts the file appears in `npm pack --dry-run --json` output, confirming `files[]` in `package.json` is correct. Uses a hermetic temp cache to avoid EPERM on systems with root-owned global cache:
```ts
const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-npm-cache-'));
try {
  const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const [packResult] = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
  assert.ok(packResult.files.map((f) => f.path).includes('ci-templates/github/forgeai.yml'),
    'ci-templates/github/forgeai.yml must be included in the npm package');
} finally {
  fs.rmSync(npmCache, { recursive: true, force: true });
}
```

**Manual acceptance** — before publishing, copy the template into a real repository, open a PR, and confirm all five GitHub Actions jobs pass. No `actionlint` is required; the automated tests cover structural correctness and the live run is the final gate.

## Release

Ships as version `3.6.0`. CHANGELOG entry under `## 3.6.0 — 2026-07-21`.
