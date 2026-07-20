import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs } from './helpers.js';

test('auto profile warns when a monorepo also has framework signals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mono-warn-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { next: '^15.0.0' } }, null, 2)
    );

    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;

    assert.equal(manifest.profile, 'monorepo');
    assert.match(output, /monorepo \+ nextjs/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile warns about a secondary stack inside a monorepo', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mono-check-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { express: '^5.0.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'monorepo'], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /monorepo \+ node-api/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Task 1: Go and Rust profiles ---

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

// --- Task 2: FastAPI and Django profiles ---

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

test('hasPythonDependency does not match a commented-out dependency array in pyproject.toml', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-pytoml-comment-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '# dependencies = ["fastapi"]\n\n[project]\nname = "my-api"\ndependencies = ["flask>=3.0"]\n'
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

// --- Task 3: React Native profile ---

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

// --- Task 4: Composition support ---

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

// --- Task 5: Confidence and ambiguity reporting ---

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

// --- Pipfile extras regression ---

test('auto profile detects FastAPI when a dep with extras appears before it in Pipfile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-pipfile-fastapi-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'Pipfile'),
      '[packages]\nuvicorn = { extras = ["standard"], version = "*" }\nfastapi = "*"\n'
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

test('auto profile detects Django when a dep with extras appears before it in Pipfile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-pipfile-django-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'Pipfile'),
      '[packages]\npsycopg2 = { extras = ["binary"], version = "*" }\nDjango = "*"\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'django');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- pyproject.toml multiline string regression ---

test('hasPythonDependency does not match a dependency name inside a TOML triple-quoted string', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-toml-multiline-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\ndescription = """\ndependencies = ["fastapi"]\n"""\ndependencies = ["flask"]\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    // Only flask is a real dep; fastapi is inside a triple-quoted description
    assert.equal(manifest.profile, 'python-api');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- pyproject.toml extras regression: bracket-counting fix ---

test('auto profile detects FastAPI from package with extras only (fastapi[standard])', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\nname = "my-api"\ndependencies = ["fastapi[standard]"]\n'
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

test('auto profile detects FastAPI when a dep with extras appears before fastapi in PEP 621 array', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-after-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\nname = "my-api"\ndependencies = ["uvicorn[standard]", "fastapi>=0.110"]\n'
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

test('auto profile detects FastAPI from Poetry inline table with extras', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fastapi-poetry-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[tool.poetry.dependencies]\npython = "^3.11"\nuvicorn = { extras = ["standard"], version = "*" }\nfastapi = "^0.110"\n'
    );
    fs.writeFileSync(path.join(target, 'poetry.lock'), '');
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'fastapi');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects Django after a dep with extras in PEP 621 array', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-django-after-extras-'));
  try {
    fs.writeFileSync(
      path.join(target, 'pyproject.toml'),
      '[project]\nname = "my-app"\ndependencies = ["gunicorn[gevent]", "Django>=4.2"]\n'
    );
    runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'django');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Task 6: Help text ---

test('--help lists new 3.5.0 profiles and composite syntax', () => {
  const output = runTs(cli, ['--help'], { cwd: os.tmpdir() });
  assert.match(output, /\bgo\b/);
  assert.match(output, /\brust\b/);
  assert.match(output, /\bfastapi\b/);
  assert.match(output, /\bdjango\b/);
  assert.match(output, /react-native/);
  assert.match(output, /nextjs\+monorepo/);
});
