import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';

export type SecurityPolicy = {
  trustedRegistries: string[];
  allowedInstallCommands: string[];
  blockedShellPatterns: string[];
  allowedDependencyExceptions: string[];
  allowedPathExceptions: string[];
};

type Finding = { location: string; detail: string };

const DEFAULT_POLICY: SecurityPolicy = {
  trustedRegistries: [
    'https://registry.npmjs.org',
    'https://registry.yarnpkg.com',
    'https://pypi.org',
    'https://rubygems.org'
  ],
  allowedInstallCommands: ['npm install', 'npm ci', 'pnpm install', 'yarn install', 'bun install', 'pip install'],
  blockedShellPatterns: [
    'curl\\s+[^|]*\\|\\s*(sudo\\s+)?(ba)?sh',
    'wget\\s+[^|]*\\|\\s*(sudo\\s+)?(ba)?sh',
    'iwr\\s+[^|]*\\|\\s*iex',
    'Invoke-WebRequest[^|]*\\|\\s*Invoke-Expression',
    'base64\\s+-d[^|]*\\|\\s*(ba)?sh'
  ],
  allowedDependencyExceptions: [],
  allowedPathExceptions: []
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.ai', 'dist', 'build', 'out', '.next', 'coverage', 'vendor', '.venv', 'venv', '.superpowers'
]);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.gz', '.tgz', '.lockb',
  '.woff', '.woff2', '.ttf', '.ico', '.mp4', '.mov', '.exe', '.dll', '.so', '.dylib'
]);
const SHELL_EXT = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd']);
const MAX_SCAN_BYTES = 512 * 1024;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
// Matches a shell shebang line (bash, zsh, dash, ksh, sh).
const SHELL_SHEBANG = /^#!.*\b(ba|z|da|k)?sh\b/;
// Matches a bare GitHub-style user/repo shorthand (e.g. "attacker/repo", "user/repo#branch").
const BARE_GITHUB_SPEC = /^[\w.-]+\/[\w.-]+(#.+)?$/;

// Read the list items under a top-level `key:` in a minimal, flat YAML file.
// Matches the hand-rolled style used elsewhere (no YAML dependency). Returns
// null when the key is absent so callers can fall back to defaults.
export function parsePolicyList(text: string, key: string): string[] | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  if (start === -1) return null;
  const items: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // next top-level key
    const match = line.match(/^\s*-\s+(.*)$/);
    if (match) items.push(unquote(match[1].replace(/\s+#.*$/, '').trim()));
  }
  return items;
}

function unquote(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadPolicy(): SecurityPolicy {
  const absolute = path.join(root, '.ai', 'security-policy.yaml');
  if (!fs.existsSync(absolute)) return DEFAULT_POLICY;
  let text: string;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    return DEFAULT_POLICY;
  }
  return {
    trustedRegistries: parsePolicyList(text, 'trusted_registries') ?? DEFAULT_POLICY.trustedRegistries,
    allowedInstallCommands: parsePolicyList(text, 'allowed_install_commands') ?? DEFAULT_POLICY.allowedInstallCommands,
    blockedShellPatterns: parsePolicyList(text, 'blocked_shell_patterns') ?? DEFAULT_POLICY.blockedShellPatterns,
    allowedDependencyExceptions:
      parsePolicyList(text, 'allowed_dependency_exceptions') ?? DEFAULT_POLICY.allowedDependencyExceptions,
    allowedPathExceptions:
      parsePolicyList(text, 'allowed_path_exceptions') ?? DEFAULT_POLICY.allowedPathExceptions
  };
}

// A path exception is a repo-relative file path (exact match) or a directory
// prefix ending in "/". It only suppresses file-scan findings (shell patterns,
// secrets); dependency findings keep their own name-based exception list.
export function isPathExcepted(relative: string, exceptions: string[]): boolean {
  const normalized = relative.split(path.sep).join('/');
  return exceptions.some((exception) =>
    exception.endsWith('/') ? normalized.startsWith(exception) : normalized === exception
  );
}

// Build compiled RegExp list from policy patterns once so it can be reused by
// both the dependency-script check and the file-scan check without re-compiling.
function compileBlockedPatterns(policy: SecurityPolicy): RegExp[] {
  const regexes: RegExp[] = [];
  for (const pattern of policy.blockedShellPatterns) {
    try {
      regexes.push(new RegExp(pattern, 'i'));
    } catch {
      // Skip an invalid policy regex rather than crashing the whole check.
    }
  }
  return regexes;
}

// Recursively collect scannable files as repo-relative paths, skipping heavy
// and harness-owned directories.
function collectFiles(directory: string, base: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(directory, entry.name), base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, path.join(directory, entry.name)));
    }
  }
}

function isShellSurface(relative: string): boolean {
  const base = path.basename(relative).toLowerCase();
  const ext = path.extname(relative).toLowerCase();
  if (SHELL_EXT.has(ext)) return true;
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return true;
  if (base === 'makefile' || base === 'gnumakefile') return true;
  const normalized = relative.split(path.sep).join('/');
  if (/(^|\/)\.github\/workflows\/[^/]+\.(yml|yaml)$/.test(normalized)) return true;
  return ['.gitlab-ci.yml', 'bitbucket-pipelines.yml', '.circleci/config.yml'].some((s) => normalized.endsWith(s));
}

function readText(relative: string): string | null {
  const ext = path.extname(relative).toLowerCase();
  if (BINARY_EXT.has(ext)) return null;
  const absolute = path.join(root, relative);
  try {
    if (fs.statSync(absolute).size > MAX_SCAN_BYTES) return null;
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function scanDependencies(policy: SecurityPolicy, blockedRegexes: RegExp[]): Finding[] {
  const findings: Finding[] = [];
  const absolute = path.join(root, 'package.json');
  if (!fs.existsSync(absolute)) return findings;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(absolute, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return [{ location: 'package.json', detail: `could not parse (${getErrorMessage(error)})` }];
  }

  const exceptions = new Set(policy.allowedDependencyExceptions);
  const depGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  let hasDeps = false;

  for (const group of depGroups) {
    const deps = manifest[group];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, rawSpec] of Object.entries(deps as Record<string, unknown>)) {
      const spec = String(rawSpec);
      hasDeps = true;
      if (exceptions.has(name)) continue;
      // Off-registry: git protocols, VCS shorthands, and bare user/repo GitHub shorthands.
      if (
        /^(git\+https?:|git\+ssh:|git\+file:|git:|github:|gitlab:|bitbucket:|https?:)/.test(spec) ||
        /^file:(\/|\.\.)/.test(spec) ||
        BARE_GITHUB_SPEC.test(spec)
      ) {
        findings.push({ location: 'package.json', detail: `off-registry dependency ${name} -> ${spec}` });
      } else if (['*', 'latest', 'x', ''].includes(spec.trim())) {
        findings.push({ location: 'package.json', detail: `unpinned dependency version ${name} -> ${spec || '(empty)'}` });
      }
    }
  }

  const scripts = manifest.scripts;
  if (scripts && typeof scripts === 'object') {
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      const command = (scripts as Record<string, unknown>)[hook];
      // Use the same compiled blockedShellPatterns (which require a pipe-to-shell) to avoid
      // false positives from bare curl/wget invocations without a pipe.
      if (typeof command === 'string' && blockedRegexes.some((re) => re.test(command))) {
        findings.push({ location: 'package.json', detail: `suspicious ${hook} script: ${command}` });
      }
    }
  }

  if (hasDeps) {
    const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];
    if (!lockfiles.some((file) => fs.existsSync(path.join(root, file)))) {
      findings.push({ location: 'package.json', detail: 'dependencies declared but no lockfile is committed' });
    }
  }

  return findings;
}

function scanShellPatterns(files: string[], blockedRegexes: RegExp[], pathExceptions: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const relative of files) {
    if (isPathExcepted(relative, pathExceptions)) continue;
    // Read text first (skips binary extensions and large files).
    const text = readText(relative);
    if (text === null) continue;
    // Scan shell surfaces by extension/name/CI path, and also extensionless
    // scripts that declare a shell interpreter via a shebang line.
    const firstLine = text.split('\n')[0] ?? '';
    if (!isShellSurface(relative) && !SHELL_SHEBANG.test(firstLine)) continue;
    for (const regex of blockedRegexes) {
      if (regex.test(text)) {
        findings.push({ location: relative, detail: 'pipe-to-shell / remote-exec pattern' });
        break;
      }
    }
  }
  return findings;
}

function scanSecrets(files: string[], pathExceptions: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const relative of files) {
    if (isPathExcepted(relative, pathExceptions)) continue;
    const text = readText(relative);
    if (text === null) continue;
    if (PRIVATE_KEY_HEADER.test(text)) {
      findings.push({ location: relative, detail: 'looks like a committed private key' });
    }
  }
  const envAbsolute = path.join(root, '.env');
  if (fs.existsSync(envAbsolute) && !isPathExcepted('.env', pathExceptions)) {
    const gitignoreAbsolute = path.join(root, '.gitignore');
    let ignored = false;
    if (fs.existsSync(gitignoreAbsolute)) {
      try {
        // Also accept `/.env` and `.env*` entries in addition to an exact `.env` line.
        ignored = /^\s*\/?\.env\*?\s*$/m.test(fs.readFileSync(gitignoreAbsolute, 'utf8'));
      } catch {
        // Fail soft: unreadable .gitignore is treated as "not ignored".
      }
    }
    if (!ignored) {
      findings.push({ location: '.env', detail: '.env is present but not ignored by .gitignore' });
    }
  }
  return findings;
}

export function runCheckSecurity(): void {
  console.log('ForgeAI supply-chain safety check');
  console.log('');

  const policy = loadPolicy();
  const files: string[] = [];
  collectFiles(root, root, files);
  // Compile blocked patterns once and share between dependency-script and file-scan checks.
  const blockedRegexes = compileBlockedPatterns(policy);

  const findings = [
    ...scanDependencies(policy, blockedRegexes),
    ...scanShellPatterns(files, blockedRegexes, policy.allowedPathExceptions),
    ...scanSecrets(files, policy.allowedPathExceptions)
  ];

  if (findings.length === 0) {
    console.log(formatStatus('ok', 'no supply-chain risks detected'));
  } else {
    for (const finding of findings) {
      console.log(formatStatus('risk', `${finding.location}: ${finding.detail}`));
    }
  }

  console.log('');
  if (findings.length > 0) {
    console.log(
      'Result: supply-chain safety check failed. Resolve the risks above or record an approved exception in .ai/security-policy.yaml.'
    );
    process.exitCode = 1;
    return;
  }
  console.log('Result: supply-chain safety check passed.');
}
