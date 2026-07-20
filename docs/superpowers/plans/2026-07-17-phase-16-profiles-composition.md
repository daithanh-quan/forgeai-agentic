# Phase 16 — Profiles and Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Go, Rust, FastAPI, Django, and React Native profiles; support explicit profile composition (`nextjs+monorepo`); add confidence/ambiguity reporting to auto-detection.

**Architecture:** New profiles follow the existing 3-file pattern. Detection in `profiles.ts` gains three format-specific Python parsers (`parsePythonPackageNames` for requirements.txt, `parsePipfileDeps` for Pipfile, `parsePyprojectDeps` for pyproject.toml — each uses exact normalized package-name matching, not substring). FastAPI and Django are pushed independently so both can be detected simultaneously (→ `'ambiguous'`). `parseCompositeProfile()` splits `+`-joined names; `resolveProfile()` validates structural correctness and each component; `runInit()` applies components in order; explicit `--profile` during `--upgrade` overrides the manifest profile. `runCheckProfile()` validates composite structure from the manifest, validates each component, and uses an any-component overlap rule for mismatch detection.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, strict), node:fs, node:test (no new runtime dependencies)

## Global Constraints

- No new runtime npm dependencies
- All tests use `node:test` (same pattern as existing test files)
- Version bump to **3.5.0**
- Each profile directory lives at `profiles/<name>/` and mirrors the `.ai/` path structure
- Profile names are lowercase, kebab-case
- `parseCompositeProfile('nextjs+monorepo')` → `['nextjs', 'monorepo']` (no filtering); `resolveProfile()` rejects: empty segments (`+`, `nextjs+`, `nextjs++monorepo`), duplicates (`nextjs+nextjs`), reserved names as component (`base+nextjs`)
- `hasPythonDependency()` uses **format-specific parsers** — `django-stubs` must NOT match `django`; a comment line containing `fastapi` must NOT match `fastapi`; multiline `pyproject.toml` dependency arrays must be parsed correctly
- FastAPI and Django are pushed as **independent** stacks (no `else if`), so a repo with both is `'ambiguous'`
- `detectConfidence()` returns `'unknown' | 'confident' | 'ambiguous'`; 0 detected primary stacks → `'unknown'`
- `--check-profile` shows `(confidence: unknown)` verbatim when no stack is detected
- `--upgrade --profile <name>`: explicit `--profile` wins over manifest profile
- `--upgrade` without `--profile`: manifest profile is preserved (existing behavior)
- `relativePath` in all log output uses `/` separator for cross-platform consistency
- Profile parser registry and code-level context exclusion enforcement are **deferred to Phase 16.1** (see Task 0 and ROADMAP.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `ROADMAP.md` | Modify | Defer "profiles register dependency parsers" to Phase 16.1 |
| `bin/lib/context.ts` | Modify | Export `isProfileExplicit` flag |
| `bin/lib/profiles.ts` | Modify | `parsePythonPackageNames()`, `parsePipfileDeps()`, `parsePyprojectDeps()`, `hasPythonDependency()` with exact matching; independent FastAPI/Django detection; updated `detectProjectStacks()`; `parseCompositeProfile()`; `detectConfidence()` with `'unknown'` state; updated `resolveProfile()` with structural + component validation + ambiguity suggestion including monorepo; updated `warnMonorepoSecondaryStack()`; updated `runCheckProfile()` with manifest structural validation + any-component mismatch rule + confidence output |
| `bin/lib/init.ts` | Modify | `runInit()` explicit-profile-wins-over-manifest logic + composite apply per component; `usage()` lists new profiles and `a+b` syntax |
| `profiles/go/` | Create | Go profile: 3 files |
| `profiles/rust/` | Create | Rust profile: 3 files |
| `profiles/fastapi/` | Create | FastAPI profile: 3 files |
| `profiles/django/` | Create | Django profile: 3 files |
| `profiles/react-native/` | Create | React Native profile: 3 files |
| `test/profile-detection.test.ts` | Modify | Stack detection, false-positive, pyproject multiline, FastAPI+Django ambiguous, composition-validation, confidence, help-text tests |
| `test/upgrade.test.ts` | Modify | Explicit-profile-during-upgrade tests |
| `README.md` | Modify | Add profiles list and composition example |
| `docs/migrations/3.5.0.md` | Create | Migration guide with mobile → react-native cleanup steps |
| `CHANGELOG.md` | Modify | Add 3.5.0 section |
| `package.json` + `package-lock.json` | Modify | Bump to 3.5.0 |

---

## Task 0: Update ROADMAP and commit plan

- [ ] **Step 1: Update ROADMAP.md Phase 16 deliverables block**

In `ROADMAP.md`, find and replace the Phase 16 deliverables (under `### Phase 16 - Profiles and composition`):

```markdown
<!-- Old: -->
Deliverables:

- Add missing Go, Rust, FastAPI-specific, Django, and React Native guidance.
- Support explicit composition such as `nextjs+monorepo`.
- Add confidence and ambiguity reporting to auto-detection.
- Let profiles register language-specific dependency parsers and context
  exclusion rules.
- Defer a community profile registry until package verification exists.
```

```markdown
<!-- New: -->
Deliverables (3.5.0):

- Add missing Go, Rust, FastAPI-specific, Django, and React Native guidance.
- Support explicit composition such as `nextjs+monorepo`.
- Add confidence and ambiguity reporting to auto-detection.
- Defer a community profile registry until package verification exists.

Deferred to Phase 16.1:

- Profile-registered language-specific dependency parsers. Hard-coded
  detection covers the 3.5.0 profiles; a registry interface requires a
  stable parser contract which does not yet exist.
- Code-level context exclusion enforcement. Each 3.5.0 profile documents
  exclusion hints in Markdown; wiring these hints to `--context-pack` /
  `--compile-context` follows in 16.1 once the parser interface is defined.
```

- [ ] **Step 2: Commit plan and ROADMAP**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-07-17-phase-16-profiles-composition.md
git commit -m "docs: add Phase 16 plan; defer parser registry to Phase 16.1 in ROADMAP"
```

---

## Task 1: Go and Rust profiles + detection

Add two non-JS ecosystem profiles. Go is detected by `go.mod`; Rust by `Cargo.toml`. Both are appended at the end of `detectProjectStacks()` with lower selection priority than JS/Python stacks (a polyglot repo may detect Go or Rust alongside JS/Python stacks, resulting in multiple detected stacks).

**Files:**
- Create: `profiles/go/.ai/profiles/go.md`
- Create: `profiles/go/.ai/skills/go-implementation/SKILL.md`
- Create: `profiles/go/.ai/workflows/go-change.md`
- Create: `profiles/rust/.ai/profiles/rust.md`
- Create: `profiles/rust/.ai/skills/rust-implementation/SKILL.md`
- Create: `profiles/rust/.ai/workflows/rust-change.md`
- Modify: `bin/lib/profiles.ts`
- Test: `test/profile-detection.test.ts`

**Interfaces:**
- Produces: `fileExists('go.mod')` → `stacks.push('go')` appended in `detectProjectStacks()`
- Produces: `fileExists('Cargo.toml')` → `stacks.push('rust')` appended in `detectProjectStacks()`

- [ ] **Step 1: Write failing tests**

Add to `test/profile-detection.test.ts`:

```typescript
test('auto profile detects Go from go.mod', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-detect-'));
  try {
    fs.writeFileSync(path.join(target, 'go.mod'), 'module example.com/myapp\n\ngo 1.22\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'go');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects Rust from Cargo.toml', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-rust-detect-'));
  try {
    fs.writeFileSync(
      path.join(target, 'Cargo.toml'),
      '[package]\nname = "my-app"\nversion = "0.1.0"\nedition = "2021"\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'rust');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('go profile initializes expected skill and workflow files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-profile-'));
  try {
    runTs(cli, ['--profile', 'go'], { cwd: target });
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'go.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'go-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'workflows', 'go-change.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('rust profile initializes expected skill and workflow files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-rust-profile-'));
  try {
    runTs(cli, ['--profile', 'rust'], { cwd: target });
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'rust.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'rust-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'workflows', 'rust-change.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|go|rust"
```

Expected: all four new tests fail

- [ ] **Step 3: Create Go profile files**

`profiles/go/.ai/profiles/go.md`:
```markdown
# Go Profile

Use this profile when the repository is a Go application or library.

## Stack signals

- `go.mod` at the project root
- `go.sum` alongside `go.mod`

## Agent focus

- Follow module path conventions from `go.mod`.
- Keep package boundaries and exported identifiers explicit.
- Prefer the standard library before adding external dependencies.
- Run `go vet` and `go test ./...` before any change is considered done.
- Check build constraints and platform-specific files when touching OS or
  architecture-sensitive code.

## Validation

```bash
go build ./...
go vet ./...
go test ./...
```

## Context exclusion hints

Do not include `vendor/`, `*.pb.go` (generated protobuf), or `*_mock.go`
(generated mocks) in context unless the task explicitly requires them.
```

`profiles/go/.ai/skills/go-implementation/SKILL.md`:
```markdown
---
name: go-implementation
description: Implement Go changes with correct package structure, exported identifiers, and test coverage.
---

# Go Implementation

Use this skill for changes in a Go project.

## Checklist

- Identify the affected package and whether changes touch exported or
  unexported identifiers.
- Keep function signatures backward compatible unless the task is a
  deliberate API change.
- Add or update `_test.go` files in the same package for unit tests and in
  a `_test` package for integration tests.
- Run `go vet ./...` to catch common mistakes before running tests.
- Run `go test ./...` and confirm all tests pass.
- Check `go.mod` and `go.sum` after adding or removing dependencies
  (`go mod tidy`).
```

`profiles/go/.ai/workflows/go-change.md`:
```markdown
# Go Change Workflow

Use this workflow for feature, bug, or refactor work in a Go project.

1. Identify the affected package and its dependents.
2. Check exported identifiers and whether the change is backward compatible.
3. Write or update `_test.go` files alongside the implementation.
4. Run `go vet ./...` to catch vet issues.
5. Run `go test ./...` and confirm all tests pass.
6. Run `go mod tidy` if dependencies changed.
```

- [ ] **Step 4: Create Rust profile files**

`profiles/rust/.ai/profiles/rust.md`:
```markdown
# Rust Profile

Use this profile when the repository is a Rust application or library.

## Stack signals

- `Cargo.toml` at the project root
- `Cargo.lock` alongside `Cargo.toml`

## Agent focus

- Follow ownership, borrowing, and lifetime rules.
- Keep public API surface (`pub`) minimal and intentional.
- Use `cargo clippy` to catch idiomatic issues before tests.
- Treat compiler errors as required reading — do not suppress with `#[allow]`
  without a documented reason.
- Check `Cargo.toml` features and workspace configuration when adding
  dependencies.

## Validation

```bash
cargo build
cargo clippy -- -D warnings
cargo test
```

## Context exclusion hints

Do not include `target/` (build artifacts) or `**/tests/fixtures/**` in
context unless the task explicitly requires them.
```

`profiles/rust/.ai/skills/rust-implementation/SKILL.md`:
```markdown
---
name: rust-implementation
description: Implement Rust changes with correct ownership, public API surface, and test coverage.
---

# Rust Implementation

Use this skill for changes in a Rust project.

## Checklist

- Understand ownership and lifetimes for any new data structures or function
  signatures.
- Keep `pub` items minimal — only expose what callers actually need.
- Add unit tests in `#[cfg(test)]` modules inside the same file and
  integration tests under `tests/`.
- Run `cargo clippy -- -D warnings` and fix all warnings before committing.
- Run `cargo test` and confirm all tests pass.
- Update `Cargo.toml` and run `cargo check` when adding or removing
  dependencies.
```

`profiles/rust/.ai/workflows/rust-change.md`:
```markdown
# Rust Change Workflow

Use this workflow for feature, bug, or refactor work in a Rust project.

1. Identify the affected crate and module.
2. Check ownership boundaries and whether the change affects public API.
3. Write or update unit tests in `#[cfg(test)]` or integration tests under
   `tests/`.
4. Run `cargo clippy -- -D warnings` and fix all warnings.
5. Run `cargo test` and confirm all tests pass.
6. Update `Cargo.toml` and run `cargo check` when dependencies change.
```

- [ ] **Step 5: Add Go and Rust detection to `bin/lib/profiles.ts`**

In `detectProjectStacks()`, append after the existing mobile block (Python and mobile detection will be replaced in Tasks 2–3):

```typescript
  // Non-JS/Python ecosystems — appended last with lower selection priority.
  // A polyglot repo may still detect these alongside JS/Python stacks.
  if (fileExists('go.mod')) stacks.push('go');
  if (fileExists('Cargo.toml')) stacks.push('rust');
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|go|rust"
```

Expected:
```
✓ auto profile detects Go from go.mod
✓ auto profile detects Rust from Cargo.toml
✓ go profile initializes expected skill and workflow files
✓ rust profile initializes expected skill and workflow files
```

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add profiles/go profiles/rust bin/lib/profiles.ts test/profile-detection.test.ts
git commit -m "feat(profiles): add Go and Rust profiles with auto-detection"
```

---

## Task 2: FastAPI and Django profiles + Python framework detection

Split the generic `python-api` detection into framework-specific variants. Three format-specific private parsers produce exact normalized package-name sets. FastAPI and Django are pushed **independently** (no `else if`) so a repo with both shows as ambiguous. `python-api` is the fallback only when neither is found.

**Files:**
- Create: `profiles/fastapi/.ai/profiles/fastapi.md`
- Create: `profiles/fastapi/.ai/skills/fastapi-implementation/SKILL.md`
- Create: `profiles/fastapi/.ai/workflows/fastapi-change.md`
- Create: `profiles/django/.ai/profiles/django.md`
- Create: `profiles/django/.ai/skills/django-implementation/SKILL.md`
- Create: `profiles/django/.ai/workflows/django-change.md`
- Modify: `bin/lib/profiles.ts`
- Test: `test/profile-detection.test.ts`

**Interfaces:**
- Produces: `function parsePythonPackageNames(content: string): Set<string>` (module-private)
- Produces: `function parsePipfileDeps(content: string): Set<string>` (module-private)
- Produces: `function parsePyprojectDeps(content: string): Set<string>` (module-private)
- Produces: `export function hasPythonDependency(names: string[]): boolean`
- Produces: updated `detectProjectStacks()` — independent fastapi/django pushes; python-api fallback

- [ ] **Step 1: Write failing tests**

Add to `test/profile-detection.test.ts`:

```typescript
test('auto profile detects FastAPI from requirements.txt', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-req-'));
  try {
    fs.writeFileSync(path.join(target, 'requirements.txt'), 'fastapi>=0.110.0\nuvicorn[standard]\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'fastapi');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects FastAPI from pyproject.toml (PEP 621 inline array)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-pep621-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\nname = "my-api"\ndependencies = ["fastapi>=0.110.0", "uvicorn"]\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'fastapi');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects FastAPI from pyproject.toml (PEP 621 multiline array)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-multi-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\nname = "my-api"\ndependencies = [\n  "fastapi>=0.110.0",\n  "uvicorn[standard]",\n  "pydantic>=2.0",\n]\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'fastapi');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects Django from requirements.txt', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-django-req-'));
  try {
    fs.writeFileSync(path.join(target, 'requirements.txt'), 'Django>=4.2\ndjango-rest-framework\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'django');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile falls back to python-api for unknown Python frameworks', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-python-fallback-'));
  try {
    fs.writeFileSync(path.join(target, 'requirements.txt'), 'flask>=3.0\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'python-api');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('hasPythonDependency does not match django-stubs when looking for django', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-django-stub-'));
  try {
    fs.writeFileSync(path.join(target, 'requirements.txt'), 'django-stubs>=4.2\nmypy\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'python-api');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('hasPythonDependency does not match a comment containing the package name', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-comment-'));
  try {
    fs.writeFileSync(
      path.join(target, 'requirements.txt'),
      '# we used to use fastapi but switched to flask\nflask>=3.0\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'python-api');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('repo with both fastapi and django is detected as ambiguous', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-both-py-'));
  try {
    fs.writeFileSync(
      path.join(target, 'requirements.txt'),
      'fastapi>=0.110.0\nDjango>=4.2\nuvicorn\n'
    );
    // auto picks fastapi (detected first) but notes ambiguity
    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    assert.match(output, /ambiguous|multiple stacks/i);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'fastapi');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('fastapi profile initializes expected skill and workflow files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-profile-'));
  try {
    runTs(cli, ['--profile', 'fastapi'], { cwd: target });
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'fastapi.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'fastapi-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'workflows', 'fastapi-change.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('django profile initializes expected skill and workflow files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-django-profile-'));
  try {
    runTs(cli, ['--profile', 'django'], { cwd: target });
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'django.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'django-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'workflows', 'django-change.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|fastapi|django|python|stub|comment|ambiguous"
```

Expected: all ten new tests fail

- [ ] **Step 3: Add format-specific parsers and `hasPythonDependency()` to `bin/lib/profiles.ts`**

Add after `fileExists()`. These three functions are module-private (no `export`).

```typescript
// requirements.txt: one package per non-comment line; extract name token only.
function parsePythonPackageNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;
    const match = line.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/);
    if (match) names.add(match[1].toLowerCase().replace(/[-_.]+/g, '-'));
  }
  return names;
}

// Pipfile: extract keys from [packages] and [dev-packages] sections.
function parsePipfileDeps(content: string): Set<string> {
  const names = new Set<string>();
  const sectionRe = /\[(?:packages|dev-packages)\]([\s\S]*?)(?=\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(content)) !== null) {
    for (const line of m[1].split('\n')) {
      const stripped = line.split('#')[0].trim();
      if (!stripped || stripped.startsWith('[')) break;
      const key = stripped.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)\s*=/)?.[1];
      if (key) names.add(key.toLowerCase().replace(/[-_.]+/g, '-'));
    }
  }
  return names;
}

// pyproject.toml: PEP 621 inline/multiline dependency arrays; Poetry/PDM section keys.
function parsePyprojectDeps(content: string): Set<string> {
  const names = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');

  // PEP 621 / PDM / Hatch: dependencies = ["pkg>=1.0", ...] possibly multiline
  const arrayMatch = content.match(/\bdependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arrayMatch) {
    for (const m of arrayMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const spec = (m[1] ?? m[2]).trim();
      const name = spec.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/)?.[1];
      if (name) names.add(norm(name));
    }
  }

  // Poetry: [tool.poetry.dependencies], [tool.poetry.dev-dependencies],
  //         [tool.poetry.group.<name>.dependencies]
  const poetryRe = /\[tool\.poetry(?:\.group\.[^\]]+)?\.(?:dev-)?dependencies\]([\s\S]*?)(?=\[|$)/g;
  let pm: RegExpExecArray | null;
  while ((pm = poetryRe.exec(content)) !== null) {
    for (const line of pm[1].split('\n')) {
      const stripped = line.split('#')[0].trim();
      if (!stripped || stripped.startsWith('[')) break;
      const key = stripped.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)\s*=/)?.[1];
      // Skip 'python' — it's a Python version constraint, not a package
      if (key && key.toLowerCase() !== 'python') names.add(norm(key));
    }
  }

  return names;
}

export function hasPythonDependency(names: string[]): boolean {
  const normalized = names.map((n) => n.toLowerCase().replace(/[-_.]+/g, '-'));

  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const pkgs = parsePythonPackageNames(fs.readFileSync(reqPath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  const pipfilePath = path.join(root, 'Pipfile');
  if (fs.existsSync(pipfilePath)) {
    const pkgs = parsePipfileDeps(fs.readFileSync(pipfilePath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  const pyprojectPath = path.join(root, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const pkgs = parsePyprojectDeps(fs.readFileSync(pyprojectPath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  return false;
}
```

- [ ] **Step 4: Update `detectProjectStacks()` in `bin/lib/profiles.ts`**

Replace the existing python-api line with independent pushes (no `else if`):

```typescript
// Old:
if (fileExists('pyproject.toml') || fileExists('requirements.txt') || fileExists('uv.lock') || fileExists('poetry.lock') || fileExists('Pipfile')) stacks.push('python-api');

// New — independent pushes so both can appear simultaneously:
const hasPythonProjectFiles = fileExists('pyproject.toml') || fileExists('requirements.txt') || fileExists('uv.lock') || fileExists('poetry.lock') || fileExists('Pipfile');
if (hasPythonProjectFiles) {
  const hasFastAPI = hasPythonDependency(['fastapi']);
  const hasDjango = hasPythonDependency(['django']);
  if (hasFastAPI) stacks.push('fastapi');
  if (hasDjango) stacks.push('django');
  if (!hasFastAPI && !hasDjango) stacks.push('python-api');
}
```

- [ ] **Step 5: Create FastAPI profile files**

`profiles/fastapi/.ai/profiles/fastapi.md`:
```markdown
# FastAPI Profile

Use this profile when the repository is a FastAPI application.

## Stack signals

- `fastapi` in `requirements.txt`, `pyproject.toml`, or `Pipfile`

## Agent focus

- Keep request and response models as Pydantic schemas — never bypass
  validation with raw `dict`.
- Preserve route path, method, and response status codes as the public
  contract.
- Use dependency injection (`Depends`) for shared resources; do not
  instantiate clients or sessions inside route functions.
- Check `alembic` or the configured migration tool before touching database
  schema.
- Validate with `pytest` and check type annotations with `mypy` when
  available.

## Validation

```bash
pytest
mypy .
ruff check .
```

## Context exclusion hints

Do not include `alembic/versions/` (generated migration scripts), `__pycache__/`,
`.env`, or `*.pyc` in context unless the task explicitly requires them.
```

`profiles/fastapi/.ai/skills/fastapi-implementation/SKILL.md`:
```markdown
---
name: fastapi-implementation
description: Implement FastAPI changes with Pydantic schemas, dependency injection, and route contract preservation.
---

# FastAPI Implementation

Use this skill for changes in a FastAPI project.

## Checklist

- Define request and response shapes as Pydantic models, not raw dicts.
- Preserve existing route paths, HTTP methods, and status codes unless the
  task is an intentional breaking change.
- Use `Depends()` for database sessions, auth, and shared clients.
- Update or add `pytest` tests that call the route through `TestClient`.
- Run `pytest` and confirm all tests pass.
- Run `mypy .` and `ruff check .` when available.
```

`profiles/fastapi/.ai/workflows/fastapi-change.md`:
```markdown
# FastAPI Change Workflow

Use this workflow for feature, bug, or refactor work in a FastAPI project.

1. Identify the affected route and its Pydantic request/response models.
2. Confirm whether the change alters the public route contract.
3. Update the Pydantic model, route handler, service, and `TestClient` tests
   together.
4. Check `alembic` migrations if the database schema changes.
5. Run `pytest` and confirm all tests pass.
6. Run `mypy .` and `ruff check .` when available.
```

- [ ] **Step 6: Create Django profile files**

`profiles/django/.ai/profiles/django.md`:
```markdown
# Django Profile

Use this profile when the repository is a Django application.

## Stack signals

- `django` in `requirements.txt`, `pyproject.toml`, or `Pipfile`

## Agent focus

- Follow Django's app, model, view, URL, and template conventions.
- Run migrations explicitly — never auto-apply in code.
- Keep business logic in models and services, not in views or serializers.
- Check DRF serializers and viewsets when touching REST endpoints.
- Validate with `manage.py test` or `pytest-django`.

## Validation

```bash
python manage.py check
python manage.py test
# or
pytest
```

## Context exclusion hints

Do not include `migrations/` directories (auto-generated), `__pycache__/`,
`.env`, `staticfiles/`, or `media/` in context unless the task explicitly
requires them.
```

`profiles/django/.ai/skills/django-implementation/SKILL.md`:
```markdown
---
name: django-implementation
description: Implement Django changes with correct app structure, migrations, and test coverage.
---

# Django Implementation

Use this skill for changes in a Django project.

## Checklist

- Identify the affected Django app and its models, views, serializers, and
  URL patterns.
- Create migrations with `manage.py makemigrations` when the database schema
  changes — never edit migration files manually.
- Keep business logic in models or separate service modules, not in views.
- Update or add tests using `TestCase` or `pytest-django` fixtures.
- Run `python manage.py check` and `python manage.py test` (or `pytest`).
- Check DRF serializers and viewsets for REST endpoint changes.
```

`profiles/django/.ai/workflows/django-change.md`:
```markdown
# Django Change Workflow

Use this workflow for feature, bug, or refactor work in a Django project.

1. Identify the affected app, model, view, and URL route.
2. Check whether the change requires a schema migration.
3. Update model, serializer, view, URL pattern, and tests together.
4. Run `manage.py makemigrations` and review the generated migration if the
   schema changed.
5. Run `python manage.py check` then `python manage.py test` (or `pytest`).
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|fastapi|django|python|stub|comment|ambiguous"
```

Expected:
```
✓ auto profile detects FastAPI from requirements.txt
✓ auto profile detects FastAPI from pyproject.toml (PEP 621 inline array)
✓ auto profile detects FastAPI from pyproject.toml (PEP 621 multiline array)
✓ auto profile detects Django from requirements.txt
✓ auto profile falls back to python-api for unknown Python frameworks
✓ hasPythonDependency does not match django-stubs when looking for django
✓ hasPythonDependency does not match a comment containing the package name
✓ repo with both fastapi and django is detected as ambiguous
✓ fastapi profile initializes expected skill and workflow files
✓ django profile initializes expected skill and workflow files
```

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add profiles/fastapi profiles/django bin/lib/profiles.ts test/profile-detection.test.ts
git commit -m "feat(profiles): add FastAPI and Django profiles with format-specific Python detection"
```

---

## Task 3: React Native profile + mobile split + upgrade explicit-profile fix

Three related changes: (1) React Native profile and detection split; (2) `--upgrade --profile <name>` must use the explicit profile, not the manifest profile; (3) migration guidance for mobile → react-native users.

**Files:**
- Create: `profiles/react-native/.ai/profiles/react-native.md`
- Create: `profiles/react-native/.ai/skills/react-native-implementation/SKILL.md`
- Create: `profiles/react-native/.ai/workflows/react-native-change.md`
- Modify: `bin/lib/profiles.ts` — split mobile detection
- Modify: `bin/lib/context.ts` — add `isProfileExplicit`
- Modify: `bin/lib/init.ts` — explicit profile wins during upgrade
- Test: `test/profile-detection.test.ts`
- Test: `test/upgrade.test.ts`

**Interfaces:**
- Produces: `export const isProfileExplicit: boolean` in `context.ts`
- Produces: updated `runInit()` — uses explicit profile when `isProfileExplicit`, else manifest profile during upgrade

- [ ] **Step 1: Write failing tests**

Add to `test/profile-detection.test.ts`:

```typescript
test('auto profile detects React Native from package.json dependency', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-rn-detect-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '0.73.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'react-native');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects React Native from Expo dependency', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expo-detect-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { expo: '~50.0.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'react-native');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile uses mobile for Flutter projects without React Native', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-flutter-detect-'));
  try {
    fs.writeFileSync(path.join(target, 'pubspec.yaml'), 'name: my_flutter_app\n');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'mobile');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('react-native profile initializes expected skill and workflow files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-rn-profile-'));
  try {
    runTs(cli, ['--profile', 'react-native'], { cwd: target });
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'react-native.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'react-native-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'workflows', 'react-native-change.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

Add to `test/upgrade.test.ts` (alongside existing upgrade tests):

```typescript
test('--upgrade --profile <name> uses explicit profile over manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-explicit-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    const beforeManifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(beforeManifest.profile, 'mobile');

    runTs(cli, ['--upgrade', '--profile', 'react-native'], { cwd: target });
    const afterManifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(afterManifest.profile, 'react-native');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade without --profile keeps manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-keep-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    runTs(cli, ['--upgrade'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'mobile');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|react-native|expo|flutter"
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|explicit|keep"
```

Expected: all six new tests fail

- [ ] **Step 3: Update mobile detection in `bin/lib/profiles.ts`**

```typescript
// Old:
if (hasDependency(packageJson, ['react-native', 'expo']) || fileExists('pubspec.yaml') || fileExists('ios') || fileExists('android')) stacks.push('mobile');

// New — React Native/Expo takes priority over generic mobile:
if (hasDependency(packageJson, ['react-native', 'expo'])) {
  stacks.push('react-native');
} else if (fileExists('pubspec.yaml') || fileExists('ios') || fileExists('android')) {
  stacks.push('mobile');
}
```

- [ ] **Step 4: Add `isProfileExplicit` to `bin/lib/context.ts`**

Add one line after the `checkUpgrade` line:

```typescript
// Old (last few lines):
export const checkUpgrade = args.has('--check-upgrade');
// ... other lines ...
export const requestedProfile = getArgValue('--profile') ?? 'base';

// New — add this line after checkUpgrade:
export const isProfileExplicit = args.has('--profile');
```

- [ ] **Step 5: Update `runInit()` in `bin/lib/init.ts` — explicit profile wins**

Update the import to include `isProfileExplicit`:

```typescript
// Old:
import { root, templateDir, dryRun, force, upgrade, requestedProfile } from './context.js';

// New:
import { root, templateDir, dryRun, force, upgrade, requestedProfile, isProfileExplicit } from './context.js';
```

Replace the profile resolution line in `runInit()`:

```typescript
// Old (bin/lib/init.ts ~line 303):
const profile = resolveProfile(upgrade ? (manifestProfile ?? requestedProfile) : requestedProfile);

// New — explicit --profile always wins; manifest profile is the fallback only when no --profile given:
const profileInput = upgrade && !isProfileExplicit ? (manifestProfile ?? requestedProfile) : requestedProfile;
const profile = resolveProfile(profileInput);
```

- [ ] **Step 6: Create React Native profile files**

`profiles/react-native/.ai/profiles/react-native.md`:
```markdown
# React Native Profile

Use this profile when the repository is a React Native or Expo application.

## Stack signals

- `react-native` or `expo` in `package.json` dependencies

## Agent focus

- Distinguish JavaScript/TypeScript logic from native platform code.
- Keep business logic platform-agnostic; isolate native modules behind
  abstractions.
- Check navigation (React Navigation or Expo Router) before moving or
  renaming screens.
- Validate on both iOS and Android when touching native integrations,
  permissions, or device APIs.
- Prefer Expo managed workflow APIs over bare native modules unless
  ejection is already complete.

## Validation

```bash
npm test
npm run lint
npx expo start --no-dev  # for Expo projects
```

## Context exclusion hints

Do not include `android/`, `ios/`, `node_modules/`, or `.expo/` in context
unless the task explicitly requires native platform files.
```

`profiles/react-native/.ai/skills/react-native-implementation/SKILL.md`:
```markdown
---
name: react-native-implementation
description: Implement React Native changes with correct platform targeting, navigation, and native module boundaries.
---

# React Native Implementation

Use this skill for changes in a React Native or Expo project.

## Checklist

- Identify whether the change is in JS/TS, a native module, or an Expo SDK
  integration.
- Check that navigation paths and screen props are consistent with the
  existing router (React Navigation or Expo Router).
- Keep platform-specific files (`*.ios.ts`, `*.android.ts`) only when
  behavior genuinely differs.
- Validate accessibility, responsive layout, and keyboard behavior for UI
  changes.
- Run `npm test` and confirm all tests pass.
- Check both iOS and Android when touching native integrations.
```

`profiles/react-native/.ai/workflows/react-native-change.md`:
```markdown
# React Native Change Workflow

Use this workflow for feature, bug, or refactor work in a React Native or
Expo project.

1. Identify whether the change is JS/TS logic, a navigation update, a
   native module call, or a UI component change.
2. Check navigation routes and screen registration before moving screens.
3. Implement in the smallest scope that satisfies the task; avoid touching
   native platform code unless necessary.
4. Validate UI on both iOS and Android dimensions and orientations.
5. Run `npm test` and confirm all tests pass.
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|react-native|expo|flutter"
node --import tsx --test test/upgrade.test.ts 2>&1 | grep -E "✓|✗|explicit|keep"
```

Expected:
```
✓ auto profile detects React Native from package.json dependency
✓ auto profile detects React Native from Expo dependency
✓ auto profile uses mobile for Flutter projects without React Native
✓ react-native profile initializes expected skill and workflow files
✓ --upgrade --profile <name> uses explicit profile over manifest profile
✓ --upgrade without --profile keeps manifest profile
```

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add profiles/react-native bin/lib/profiles.ts bin/lib/context.ts bin/lib/init.ts test/profile-detection.test.ts test/upgrade.test.ts
git commit -m "feat(profiles): add React Native profile; split mobile; explicit --profile wins during upgrade"
```

---

## Task 4: Composition support (`nextjs+monorepo`)

Parse `+`-joined profile names, validate the composite structure (no empty segments, no duplicates, no reserved names), validate each component, apply all components in order during install. `runCheckProfile()` validates composite structure from the manifest and uses an any-component overlap rule for mismatch. Update `warnMonorepoSecondaryStack` to suggest composition.

**Files:**
- Modify: `bin/lib/profiles.ts`
- Modify: `bin/lib/init.ts`
- Test: `test/profile-detection.test.ts`

**Interfaces:**
- Produces: `export function parseCompositeProfile(profile: string): string[]`
- Consumes: `profilePath(component)` and `copyRecursive(path, root)` — called once per component in `runInit()`

- [ ] **Step 1: Write failing tests**

Add to `test/profile-detection.test.ts`:

```typescript
test('composite profile nextjs+monorepo is valid and installs files from both profiles', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-nextjs-mono-'));
  try {
    runTs(cli, ['--profile', 'nextjs+monorepo'], { cwd: target });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'nextjs+monorepo');

    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'nextjs-implementation', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'profiles', 'monorepo.md')));
    assert.ok(fs.existsSync(path.join(target, '.ai', 'skills', 'monorepo-boundaries', 'SKILL.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('composite profile with unknown component exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-bad-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'nextjs+nonexistent'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /unknown profile component.*nonexistent/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('empty composite (+) exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-empty-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', '+'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /empty|invalid/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('trailing-plus composite (nextjs+) exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-trail-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'nextjs+'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /empty|invalid/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('double-plus composite (nextjs++monorepo) exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-dbl-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'nextjs++monorepo'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /empty|invalid/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('duplicate component (nextjs+nextjs) exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-dup-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'nextjs+nextjs'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /duplicate/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('base as composite component (base+nextjs) exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-base-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'base+nextjs'], { cwd: target }),
      (error: unknown) => {
        const out = String((error as ExecError).stderr ?? '') + String((error as ExecError).stdout ?? '');
        assert.match(out, /cannot be used as a composite/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-profile reports mismatch when no composite component matches detected stacks', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-mismatch-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { next: '^15.0.0' } }, null, 2)
    );
    // Install go+rust on a Next.js project
    runTs(cli, ['--profile', 'go+rust'], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /mismatch/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-profile flags corrupt composite in manifest', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-corrupt-manifest-'));
  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });
    // Manually corrupt the manifest composite
    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessManifest;
    manifest.profile = 'nextjs++monorepo';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid|corrupt/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('warnMonorepoSecondaryStack suggests composition for single monorepo install', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mono-suggest-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { next: '^15.0.0' } }, null, 2)
    );
    const output = runTs(cli, ['--profile', 'monorepo'], { cwd: target });
    assert.match(output, /monorepo\+nextjs/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('warnMonorepoSecondaryStack is silent when composite already includes secondary', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compose-quiet-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { next: '^15.0.0' } }, null, 2)
    );
    const output = runTs(cli, ['--profile', 'monorepo+nextjs'], { cwd: target });
    assert.doesNotMatch(output, /consider.*monorepo\+nextjs/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|compos|nextjs\+|suggest|mismatch|corrupt|empty|duplicate|base\+"
```

Expected: all eleven new tests fail

- [ ] **Step 3: Add `parseCompositeProfile()` to `bin/lib/profiles.ts`**

Add after `normalizeProfile()`. Does NOT filter empty strings — they are kept for structural validation in `resolveProfile()`.

```typescript
export function parseCompositeProfile(profile: string): string[] {
  return profile.split('+').map((p) => p.trim());
}
```

- [ ] **Step 4: Update `resolveProfile()` in `bin/lib/profiles.ts`**

Replace the existing `resolveProfile()` with structural validation before the component loop:

```typescript
export function resolveProfile(profile: string): { status: 'ok' | 'none' | 'invalid' | 'unknown'; profile: string; detail: string } {
  const normalized = normalizeProfile(profile);
  if (normalized === 'base' || normalized === 'none') {
    return { status: 'none', profile: 'base', detail: 'base harness only' };
  }

  let resolvedProfile: string | null;
  if (normalized === 'auto') {
    resolvedProfile = detectProjectProfile();
    if (!resolvedProfile) {
      return { status: 'unknown', profile: 'base', detail: 'auto profile could not detect a supported stack' };
    }
  } else {
    resolvedProfile = normalized;
  }

  // Structural validation of the composite form.
  const rawParts = parseCompositeProfile(resolvedProfile);
  if (rawParts.some((p) => p === '')) {
    return {
      status: 'invalid',
      profile: resolvedProfile,
      detail: 'invalid composite: profile contains an empty component (check for leading, trailing, or consecutive "+")'
    };
  }
  const seen = new Set<string>();
  for (const part of rawParts) {
    if (part === 'base' || part === 'none') {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `"${part}" cannot be used as a composite component`
      };
    }
    if (seen.has(part)) {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `duplicate profile component "${part}" in composite "${resolvedProfile}"`
      };
    }
    seen.add(part);
  }

  const availableProfiles = getAvailableProfiles();
  for (const component of rawParts) {
    if (!availableProfiles.includes(component)) {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `unknown profile component "${component}". Available profiles: ${availableProfiles.join(', ') || 'none'}`
      };
    }
  }

  const detail = normalized === 'auto'
    ? `auto detected ${resolvedProfile}`
    : rawParts.length > 1
      ? `composite: ${rawParts.join(' + ')}`
      : resolvedProfile;

  return { status: 'ok', profile: resolvedProfile, detail };
}
```

- [ ] **Step 5: Update `warnMonorepoSecondaryStack()` in `bin/lib/profiles.ts`**

```typescript
export function warnMonorepoSecondaryStack(installedProfile: string): void {
  const components = parseCompositeProfile(installedProfile);
  if (!components.includes('monorepo')) return;
  if (components.length > 1) return;
  const secondary = detectMonorepoSecondaryStack();
  if (!secondary) return;
  console.log(`note: detected monorepo + ${secondary}; consider --profile monorepo+${secondary} for combined guidance`);
}
```

- [ ] **Step 6: Update `runCheckProfile()` in `bin/lib/profiles.ts`**

Replace from `if (installedProfile === 'base')` to end of function. Key additions: (a) manifest composite structure validation; (b) any-component overlap rule for mismatch.

```typescript
  if (installedProfile === 'base') {
    console.log('');
    console.log('Result: base harness installed. Run forgeai-init --profile <name> to add stack-specific guidance if needed.');
    return;
  }

  // Validate composite structure from manifest (catches manually corrupted manifests).
  const rawParts = parseCompositeProfile(installedProfile);
  if (rawParts.some((p) => p === '')) {
    console.log(formatStatus('invalid', `manifest profile "${installedProfile}" has an invalid composite structure (empty component)`));
    console.log('');
    console.log('Result: installed profile is corrupt. Re-run forgeai-init --profile to fix.');
    process.exitCode = 1;
    return;
  }
  const seenParts = new Set<string>();
  for (const part of rawParts) {
    if (part === 'base' || part === 'none' || seenParts.has(part)) {
      console.log(formatStatus('invalid', `manifest profile "${installedProfile}" contains invalid component "${part}"`));
      console.log('');
      console.log('Result: installed profile is corrupt. Re-run forgeai-init --profile to fix.');
      process.exitCode = 1;
      return;
    }
    seenParts.add(part);
  }
  const components = rawParts;

  let missingProfileFiles = 0;
  let hasInvalidComponent = false;

  for (const component of components) {
    const componentPath = profilePath(component);
    if (!fs.existsSync(componentPath)) {
      console.log(formatStatus('invalid', `profile component "${component}" is not supported by this package version`));
      hasInvalidComponent = true;
      continue;
    }
    const requiredFiles = listFilesRecursive(componentPath);
    for (const relativePath of requiredFiles) {
      const exists = fs.existsSync(path.join(root, relativePath));
      if (!exists) missingProfileFiles += 1;
      console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
    }
  }

  if (hasInvalidComponent) {
    console.log('');
    console.log('Result: installed profile is not recognized.');
    process.exitCode = 1;
    return;
  }

  // Mismatch: at least one installed component must appear in detected stacks.
  // If no stacks detected, skip (cannot judge).
  const detectedStacks = detectProjectStacks();
  if (detectedStacks.length > 0 && !components.some((c) => detectedStacks.includes(c))) {
    const primaryDetected = detectedStacks.filter((s) => s !== 'monorepo');
    const detectedDisplay = primaryDetected.length > 0 ? primaryDetected.join(', ') : detectedStacks.join(', ');
    console.log('');
    console.log(`Result: profile mismatch. Installed "${installedProfile}", but project signals look like ${detectedDisplay}.`);
    process.exitCode = 1;
    return;
  }

  if (missingProfileFiles > 0) {
    console.log('');
    console.log('Result: profile files are incomplete. Re-run forgeai-init --profile with the same profile.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Result: profile installed and consistent.');
```

> `detectedProfile` is still declared earlier in `runCheckProfile()` for the header line; `detectedStacks` is a new local.

- [ ] **Step 7: Update `runInit()` in `bin/lib/init.ts` to apply each component**

Update the import:

```typescript
// Old:
import { resolveProfile, profilePath, warnMonorepoSecondaryStack } from './profiles.js';

// New:
import { resolveProfile, profilePath, warnMonorepoSecondaryStack, parseCompositeProfile } from './profiles.js';
```

Replace the `copyRecursive` profile call:

```typescript
// Old:
  if (profile.status === 'ok') {
    copyRecursive(profilePath(profile.profile), root);
  }

// New:
  if (profile.status === 'ok') {
    for (const component of parseCompositeProfile(profile.profile)) {
      copyRecursive(profilePath(component), root);
    }
  }
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|compos|nextjs\+|suggest|mismatch|corrupt|empty|duplicate|base\+"
```

Expected:
```
✓ composite profile nextjs+monorepo is valid and installs files from both profiles
✓ composite profile with unknown component exits 1
✓ empty composite (+) exits 1
✓ trailing-plus composite (nextjs+) exits 1
✓ double-plus composite (nextjs++monorepo) exits 1
✓ duplicate component (nextjs+nextjs) exits 1
✓ base as composite component (base+nextjs) exits 1
✓ --check-profile reports mismatch when no composite component matches detected stacks
✓ --check-profile flags corrupt composite in manifest
✓ warnMonorepoSecondaryStack suggests composition for single monorepo install
✓ warnMonorepoSecondaryStack is silent when composite already includes secondary
```

- [ ] **Step 9: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add bin/lib/profiles.ts bin/lib/init.ts test/profile-detection.test.ts
git commit -m "feat(profiles): support composite profile installation with structural validation"
```

---

## Task 5: Confidence and ambiguity reporting

Add `detectConfidence()` returning `'unknown' | 'confident' | 'ambiguous'`: 0 primary stacks → `'unknown'`, 1 → `'confident'`, 2+ → `'ambiguous'`. Surface in `--check-profile` (with `(confidence: unknown)` verbatim when no stack found) and in `--profile auto` install message. Ambiguity suggestion includes all detected stacks (monorepo not filtered out).

**Files:**
- Modify: `bin/lib/profiles.ts`
- Test: `test/profile-detection.test.ts`

**Interfaces:**
- Produces: `export function detectConfidence(): 'unknown' | 'confident' | 'ambiguous'`

- [ ] **Step 1: Write failing tests**

Add to `test/profile-detection.test.ts`:

```typescript
test('--check-profile reports confident when exactly one primary stack is detected', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-conf-one-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { next: '^15.0.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    const output = runTs(cli, ['--check-profile'], { cwd: target });
    assert.match(output, /\bconfident\b/i);
    assert.doesNotMatch(output, /\bambiguous\b/i);
    assert.doesNotMatch(output, /confidence: unknown/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-profile reports ambiguous when multiple primary stacks are detected', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-conf-many-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { next: '^15.0.0', express: '^5.0.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /\bambiguous\b/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-profile shows confidence: unknown when no stacks are detected', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-conf-zero-'));
  try {
    // Empty directory — no project signals
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    // Must show the exact string "confidence: unknown"
    assert.match(output, /confidence: unknown/i);
    assert.doesNotMatch(output, /\bconfident\b/i);
    assert.doesNotMatch(output, /\bambiguous\b/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--profile auto logs ambiguity note when multiple primary stacks are detected', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-conf-auto-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { next: '^15.0.0', express: '^5.0.0' } }, null, 2)
    );
    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    assert.match(output, /ambiguous|multiple stacks/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('ambiguity suggestion for monorepo + nextjs + node-api includes all three', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-conf-mono-full-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({
        workspaces: ['packages/*'],
        dependencies: { next: '^15.0.0', express: '^5.0.0' }
      }, null, 2)
    );
    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    // Suggestion must include monorepo, not just nextjs+node-api
    assert.match(output, /monorepo.*nextjs|nextjs.*monorepo/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|confident|ambiguous|unknown|suggestion"
```

Expected: all five new tests fail

- [ ] **Step 3: Add `detectConfidence()` to `bin/lib/profiles.ts`**

Add after `detectMonorepoSecondaryStack()`:

```typescript
export function detectConfidence(): 'unknown' | 'confident' | 'ambiguous' {
  const primaryStacks = detectProjectStacks().filter((s) => s !== 'monorepo');
  if (primaryStacks.length === 0) return 'unknown';
  return primaryStacks.length > 1 ? 'ambiguous' : 'confident';
}
```

- [ ] **Step 4: Update `resolveProfile()` — add auto ambiguity note including monorepo**

Inside the `auto` branch (after `resolvedProfile` is assigned), add before the structural validation block. Replace the current `auto` branch:

```typescript
  if (normalized === 'auto') {
    resolvedProfile = detectProjectProfile();
    if (!resolvedProfile) {
      return { status: 'unknown', profile: 'base', detail: 'auto profile could not detect a supported stack' };
    }
    if (detectConfidence() === 'ambiguous') {
      // Include all detected stacks (including monorepo) in the suggestion.
      const allDetected = detectProjectStacks();
      const suggestion = allDetected.join('+');
      console.log(
        `note: multiple stacks detected (${allDetected.join(', ')}); installing ${resolvedProfile}. ` +
        `For combined guidance use --profile ${suggestion}.`
      );
    }
  } else {
    resolvedProfile = normalized;
  }
```

- [ ] **Step 5: Update `runCheckProfile()` to show confidence**

Replace the detected-profile log line:

```typescript
// Old:
console.log(formatStatus(detectedProfile ? 'detected' : 'unknown', detectedProfile ?? 'no supported stack profile detected'));

// New:
const confidence = detectConfidence();
const detectedLabel = detectedProfile
  ? `${detectedProfile} (${confidence})`
  : 'no supported stack profile detected (confidence: unknown)';
console.log(formatStatus(detectedProfile ? 'detected' : 'unknown', detectedLabel));
```

> When `detectedProfile` is non-null, the label is e.g. `nextjs (confident)`. When `detectedProfile` is null (0 stacks), the label explicitly includes `(confidence: unknown)` so the test can assert on `confidence: unknown`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|confident|ambiguous|unknown|suggestion"
```

Expected:
```
✓ --check-profile reports confident when exactly one primary stack is detected
✓ --check-profile reports ambiguous when multiple primary stacks are detected
✓ --check-profile shows confidence: unknown when no stacks are detected
✓ --profile auto logs ambiguity note when multiple primary stacks are detected
✓ ambiguity suggestion for monorepo + nextjs + node-api includes all three
```

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add bin/lib/profiles.ts test/profile-detection.test.ts
git commit -m "feat(profiles): add three-state confidence reporting with monorepo-inclusive suggestions"
```

---

## Task 6: Help text, README, version, migration doc, changelog

**Files:**
- Modify: `bin/lib/init.ts` — update `usage()` to list new profiles and `a+b` syntax
- Modify: `README.md` — add profiles section and composition example
- Modify: `package.json` + `package-lock.json`
- Create: `docs/migrations/3.5.0.md`
- Modify: `CHANGELOG.md`
- Test: `test/profile-detection.test.ts`

- [ ] **Step 1: Write failing help-text test**

Add to `test/profile-detection.test.ts` BEFORE making any implementation changes:

```typescript
test('--help lists new 3.5.0 profiles and composite syntax', () => {
  const output = runTs(cli, ['--help'], { cwd: os.tmpdir() });
  assert.match(output, /\bgo\b/);
  assert.match(output, /\brust\b/);
  assert.match(output, /\bfastapi\b/);
  assert.match(output, /\bdjango\b/);
  assert.match(output, /react-native/);
  assert.match(output, /nextjs\+monorepo/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|3\.5\.0 profiles|help lists"
```

Expected: test fails (help still shows old profile list)

- [ ] **Step 3: Update `usage()` in `bin/lib/init.ts`**

Find the `--profile` option line in `usage()`:

```typescript
// Old:
  --profile     Apply an optional stack profile: auto, nextjs, node-api, tauri, monorepo, python-api, or mobile.
```

Replace with:

```typescript
// New:
  --profile     Apply an optional stack profile: auto, nextjs, node-api, tauri, monorepo,
                python-api, mobile, go, rust, fastapi, django, or react-native.
                Combine profiles with +: --profile nextjs+monorepo.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
node --import tsx --test test/profile-detection.test.ts 2>&1 | grep -E "✓|✗|help lists"
```

Expected: `✓ --help lists new 3.5.0 profiles and composite syntax`

- [ ] **Step 5: Update `README.md` — add profiles section**

Find the `--profile auto` line in `README.md` and add a section below it (or around it):

```markdown
## Profiles

ForgeAI includes stack-specific guidance profiles. Apply with `--profile <name>`:

| Profile | Detected by |
|---------|-------------|
| `nextjs` | `next` in `package.json` |
| `node-api` | `express`, `fastify`, `@nestjs/core`, `hono`, `koa` |
| `python-api` | Python project files (fallback) |
| `fastapi` | `fastapi` in Python dependency files |
| `django` | `django` in Python dependency files |
| `mobile` | `pubspec.yaml`, `ios/`, `android/` (Flutter/native) |
| `react-native` | `react-native` or `expo` in `package.json` |
| `go` | `go.mod` |
| `rust` | `Cargo.toml` |
| `monorepo` | `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `workspaces` |
| `tauri` | `src-tauri/`, `tauri.conf.json` |

Combine profiles with `+` for polyglot or monorepo projects:

```bash
npx forgeai-agentic-init@latest --profile nextjs+monorepo
npx forgeai-agentic-init@latest --profile fastapi+go
```

Use `--profile auto` to let ForgeAI detect your stack automatically.
```

- [ ] **Step 6: Bump version**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm version 3.5.0 --no-git-tag-version
```

Verify:

```bash
grep '"version"' package.json
```

Expected: `"version": "3.5.0"`

- [ ] **Step 7: Create `docs/migrations/3.5.0.md`**

```markdown
# Migration Guide — 3.5.0

## What changed

### New profiles

Five new profiles are available. Install with `--profile <name>` or
`--profile auto` (auto-detection updated to recognize all five):

- **`go`** — Go applications and libraries. Detected by `go.mod`.
- **`rust`** — Rust applications and libraries. Detected by `Cargo.toml`.
- **`fastapi`** — FastAPI applications. Detected by exact `fastapi` package
  name in `requirements.txt`, `pyproject.toml` (PEP 621 and Poetry), or
  `Pipfile`. Takes priority over `python-api` when FastAPI is present.
- **`django`** — Django applications. Detected by exact `django` package
  name in Python dependency files. Takes priority over `python-api`.
- **`react-native`** — React Native and Expo applications. Detected by
  `react-native` or `expo` in `package.json`. Previously received `mobile`.
  `mobile` now covers Flutter and native-only projects without RN/Expo.

### Profile composition

Profiles can now be combined with `+`:

```bash
forgeai-init --profile nextjs+monorepo
```

Both profile directories are applied in order. The manifest stores the full
composite name (`nextjs+monorepo`). `--check-profile` validates each
component and reports a mismatch when none of the components match detected
project signals.

Invalid composite forms exit 1: empty segments (`nextjs+`, `+`,
`nextjs++monorepo`), duplicate components (`nextjs+nextjs`), and reserved
names (`base+nextjs`) are all rejected.

### Confidence/ambiguity reporting

`--check-profile` now shows confidence alongside the detected profile:

- `(confident)` — exactly one primary stack detected
- `(ambiguous)` — two or more primary stacks detected
- `(confidence: unknown)` — no stacks detected; cannot compare

`--profile auto` logs a composition suggestion when multiple stacks are found.
The suggestion includes all detected stacks (including `monorepo`).

### Python detection

Detection now uses exact normalized package-name parsing per file format:
- `requirements.txt` — package name token per line (comments stripped)
- `Pipfile` — keys in `[packages]` and `[dev-packages]` sections
- `pyproject.toml` — PEP 621 inline/multiline dependency arrays; Poetry section keys

`django-stubs` no longer triggers the `django` profile. Comments no longer
match package names.

FastAPI and Django are detected independently; a project with both is reported
as `ambiguous`.

## Upgrade steps

Run `forgeai-init --upgrade`. No schema changes required.

### React Native / Expo projects

If you have an existing install with `profile: "mobile"` and your project uses
`react-native` or `expo`, run:

```bash
forgeai-init --upgrade --profile react-native
```

The `--profile` flag now overrides the manifest profile during `--upgrade`.
Then remove the leftover mobile profile files (they are project-owned once written
and are not removed automatically):

```bash
rm .ai/profiles/mobile.md
rm -rf .ai/skills/mobile-implementation
rm .ai/workflows/mobile-change.md
```

After removal, `--check-profile` should report `react-native` and consistent.
```

- [ ] **Step 8: Add 3.5.0 entry to `CHANGELOG.md`**

Prepend before the existing `## 3.4.0` line:

```markdown
## 3.5.0 — 2026-07-17

### Added

- **Go profile** (`--profile go`): auto-detected from `go.mod`. Package-boundary,
  `go vet`/`go test` workflow, and context exclusion hints for `vendor/` and
  generated files.
- **Rust profile** (`--profile rust`): auto-detected from `Cargo.toml`. Ownership/
  borrowing guidance, `cargo clippy` workflow, context exclusion hints for `target/`.
- **FastAPI profile** (`--profile fastapi`): auto-detected from exact `fastapi` package
  name in Python dependency files. Pydantic schema guidance and Alembic awareness.
- **Django profile** (`--profile django`): auto-detected from exact `django` package
  name in Python dependency files. App structure, ORM, and migration workflow.
- **React Native profile** (`--profile react-native`): auto-detected from
  `react-native` or `expo` dependencies. Platform targeting, navigation, and native
  module boundary guidance.
- **Profile composition**: `--profile nextjs+monorepo` applies both profiles, stores
  the composite name in the manifest, validates structural correctness (empty
  segments, duplicates, reserved names), and validates each component during
  `--check-profile`.
- **Three-state confidence**: `--check-profile` shows `(confident)`, `(ambiguous)`,
  or `(confidence: unknown)`. `--profile auto` logs a composition suggestion including
  monorepo when multiple primary stacks are found.
- `--upgrade --profile <name>` now uses the explicit profile instead of the manifest
  profile, enabling in-place profile migration (e.g., `mobile` → `react-native`).

### Changed

- Python detection uses format-specific exact-match parsers; `django-stubs` and
  comments no longer produce false positives.
- FastAPI and Django are detected independently; a project with both is reported
  as `ambiguous`.
- Mobile detection separates React Native/Expo (`react-native`) from Flutter/native
  (`mobile`).
- Monorepo secondary-stack warning suggests the composite form
  (`--profile monorepo+<secondary>`).
- `--help` lists all profiles including `go`, `rust`, `fastapi`, `django`,
  `react-native`, and the `a+b` composition syntax.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.5.0.md`.
React Native/Expo projects: run `forgeai-init --upgrade --profile react-native`
and remove leftover mobile profile files (see migration guide for exact paths).

```

- [ ] **Step 9: Run the full test suite**

```bash
cd /Users/admin/Documents/Learn/forgeai-agentic
npm test 2>&1 | tail -10
```

Expected: all tests pass with version 3.5.0

- [ ] **Step 10: Commit**

```bash
git add bin/lib/init.ts README.md package.json package-lock.json docs/migrations/3.5.0.md CHANGELOG.md test/profile-detection.test.ts
git commit -m "chore: release 3.5.0 — profiles and composition (Phase 16)"
```

---

## Self-Review

**Spec coverage:**

| Deliverable | Task | Notes |
|-------------|------|-------|
| Add missing Go guidance | Task 1 | `profiles/go/`, detection via `go.mod` |
| Add missing Rust guidance | Task 1 | `profiles/rust/`, detection via `Cargo.toml` |
| Add FastAPI-specific guidance | Task 2 | `profiles/fastapi/`, format-specific exact-match parsing |
| Add Django guidance | Task 2 | `profiles/django/`, independent push (not `else if`) |
| Add React Native guidance | Task 3 | `profiles/react-native/`, split from `mobile` detection |
| Support explicit composition | Task 4 | `parseCompositeProfile()`, structural + component validation, composite install/check |
| Confidence/ambiguity reporting | Task 5 | `detectConfidence()` with `'unknown'` state; monorepo-inclusive suggestion |
| Profile-registered dependency parsers | — | **Deferred to Phase 16.1.** Hard-coded detection covers 3.5.0 profiles. See ROADMAP.md. |
| Profile-registered context exclusion enforcement | — | **Deferred to Phase 16.1.** Exclusion hints documented in Markdown per profile. |
| Defer community profile registry | — | Not implemented; noted in ROADMAP |

**Issues resolved vs. prior drafts:**

1. **pyproject.toml parser** — `parsePyprojectDeps()` reads PEP 621 inline/multiline dependency arrays and Poetry section keys. Multiline array test added.
2. **FastAPI+Django ambiguous** — independent pushes (no `else if`); test verifies both are detected simultaneously.
3. **mobile → react-native migration** — `isProfileExplicit` in context.ts; `runInit()` uses explicit profile when provided; `--upgrade --profile react-native` tested; migration guide provides exact cleanup file paths.
4. **Composite validation** — `parseCompositeProfile()` keeps empty strings; `resolveProfile()` rejects them; 5 structural-validation tests added.
5. **Composite mismatch** — any-component overlap rule; `go+rust` on Next.js → mismatch; test added.
6. **Manifest composite validation** — `runCheckProfile()` validates structure from manifest before component loop; corrupt manifest test added.
7. **Confidence `unknown`** — `detectConfidence()` returns `'unknown'` for 0 stacks; `--check-profile` shows `(confidence: unknown)` verbatim; test asserts exact string.
8. **Monorepo in suggestion** — suggestion uses `detectProjectStacks()` (all stacks, no limit, monorepo not filtered); test for monorepo+nextjs+node-api asserts monorepo presence.
9. **Help TDD order** — test written first (Step 1), fails verified (Step 2), `usage()` updated (Step 3), passes verified (Step 4).
10. **README** — profiles table and composition example added (Task 6 Step 5).
11. **Task 1 wording** — "lower selection priority" instead of "never conflict".

**Placeholder scan:** No TBD, TODO, or vague instructions.

**Type consistency:**
- `parseCompositeProfile(profile: string): string[]` — defined in `profiles.ts`, imported in `init.ts`, used in `runCheckProfile()` and `warnMonorepoSecondaryStack()`
- `detectConfidence(): 'unknown' | 'confident' | 'ambiguous'` — defined and used in `profiles.ts`
- `hasPythonDependency(names: string[]): boolean` — uses three format-specific private parsers
- `isProfileExplicit: boolean` — exported from `context.ts`, imported in `init.ts`
- `resolveProfile()` return type unchanged; all callers still work
