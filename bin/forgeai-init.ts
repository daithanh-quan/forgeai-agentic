#!/usr/bin/env -S tsx
import fs, { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Adapter = {
  command?: string;
};

type AdapterConfig = {
  adapters?: Record<string, Adapter>;
};

type HarnessManifest = {
  version: number;
  package: string;
  package_version: string;
  profile: string;
  initialized_at: string;
};

type AgentSession = {
  id: string;
  owner: string;
  task: string;
  branch: string;
  status: string;
  started: string;
  readScope: string[];
  writeScope: string[];
  notes: string;
};

type TaskJournal = {
  file: string;
  taskId: string;
  taskType: string;
  currentState: string;
  lastUpdated: string;
  staleStatus: string;
  memoryUpdateChecked: boolean;
  noMemoryUpdateChecked: boolean;
};

type CodeGraphNode = {
  id?: string;
  path?: string;
  type?: string;
  summary?: string;
  confidence?: string;
};

type CodeGraphEdge = {
  from?: string;
  to?: string;
  kind?: string;
  summary?: string;
  confidence?: string;
};

type CodeGraph = {
  schema_version?: number;
  generated_at?: string;
  source?: string;
  repository?: {
    name?: string;
    root?: string;
    profile?: string;
  };
  nodes?: CodeGraphNode[];
  edges?: CodeGraphEdge[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(process.cwd());
const templateDir = path.resolve(__dirname, '../templates');
const profilesDir = path.resolve(__dirname, '../profiles');
const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageName = 'forgeai-agentic-init';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const help = args.has('--help') || args.has('-h');
const version = args.has('--version') || args.has('-v');
const force = args.has('--force');
const upgrade = args.has('--upgrade');
const dryRun = args.has('--dry-run');
const check = args.has('--check');
const checkGit = args.has('--check-git');
const checkSessions = args.has('--check-sessions');
const checkLifecycle = args.has('--check-lifecycle');
const checkCodeGraph = args.has('--check-codegraph');
const checkProfile = args.has('--check-profile');
const listProfiles = args.has('--list-profiles');
const checkUpdates = args.has('--check-updates');
const skipUpdateCheck = args.has('--skip-update-check') || process.env.FORGEAI_SKIP_UPDATE_CHECK === '1';
const requestedProfile = getArgValue('--profile') ?? 'base';

const requiredHarnessFiles = listFilesRecursive(templateDir);

const bootstrapFiles = ['.ai/PROJECT.md', '.ai/MEMORY.md', '.ai/AGENT_REGISTRY.md'];
const lifecycleStates = [
  'intake',
  'triage',
  'planning',
  'specification',
  'assignment',
  'execution',
  'validation',
  'review',
  'revision',
  'acceptance',
  'delivery',
  'memory-update',
  'closed'
];
const taskTypes = ['bug', 'feature', 'refactor', 'research', 'audit', 'incident', 'release', 'dependency-upgrade'];

function getArgValue(name: string): string | null {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === name) return rawArgs[index + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }

  return null;
}

function formatStatus(status: string, label: string): string {
  return `${status.padEnd(16)} ${label}`;
}

function commandExists(command: string | undefined): boolean {
  if (!command) return false;

  if (command.includes('/') || command.includes('\\')) {
    try {
      fs.accessSync(path.resolve(root, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      try {
        fs.accessSync(path.join(entry, `${command}${extension}`), constants.X_OK);
        return true;
      } catch {
        // Keep searching PATH.
      }
    }
  }

  return false;
}

function readJsonIfPresent<T>(relativePath: string): T | null {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

function readJsonFileIfPresent<T>(absolutePath: string): T | null {
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

function countTodos(relativePath: string): number {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return 0;
  const content = fs.readFileSync(absolutePath, 'utf8');
  return (content.match(/\bTODO\b/g) || []).length;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSemver(versionValue: string | undefined): [number, number, number] | null {
  if (!versionValue) return null;
  const match = versionValue.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string | undefined, right: string | undefined): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

function listFilesRecursive(directory: string, baseDirectory = directory): string[] {
  if (!fs.existsSync(directory)) return [];

  const files: string[] = [];

  for (const item of fs.readdirSync(directory)) {
    const absolutePath = path.join(directory, item);
    const stat = fs.statSync(absolutePath);

    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath, baseDirectory));
      continue;
    }

    files.push(path.relative(baseDirectory, absolutePath).split(path.sep).join('/'));
  }

  return files.sort();
}

function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function getLatestPackageVersion(): { version: string | null; error: string | null } {
  const mockedVersion = process.env.FORGEAI_TEST_LATEST_VERSION;
  if (mockedVersion) return { version: mockedVersion, error: null };

  const result = spawnSync('npm', ['view', packageName, 'version', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 1024 * 1024
  });

  if (result.error) return { version: null, error: result.error.message };
  if (result.status !== 0) return { version: null, error: (result.stderr || result.stdout || 'npm view failed').trim() };

  const rawVersion = result.stdout.trim().replace(/^"|"$/g, '');
  return parseSemver(rawVersion) ? { version: rawVersion, error: null } : { version: null, error: `invalid npm version: ${rawVersion}` };
}

function getAvailableProfiles(): string[] {
  if (!fs.existsSync(profilesDir)) return [];
  return fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function profilePath(profile: string): string {
  return path.join(profilesDir, profile);
}

function normalizeProfile(profile: string): string {
  return profile.trim().toLowerCase();
}

function getProjectPackageJson(): PackageJson | null {
  const absolutePath = path.join(root, 'package.json');
  if (!fs.existsSync(absolutePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as PackageJson;
  } catch (error) {
    console.log(`invalid package.json: ${getErrorMessage(error)} (profile detection skipped)`);
    return null;
  }
}

function hasDependency(packageJson: PackageJson | null, names: string[]): boolean {
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };

  return names.some((name) => dependencies[name] !== undefined);
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function detectProjectProfile(): string | null {
  const packageJson = getProjectPackageJson();

  if (fileExists('src-tauri') || fileExists('tauri.conf.json') || fileExists('tauri.conf.json5')) return 'tauri';
  if (fileExists('pnpm-workspace.yaml') || fileExists('turbo.json') || fileExists('nx.json') || fileExists('lerna.json') || packageJson?.workspaces) return 'monorepo';
  if (hasDependency(packageJson, ['next']) || fileExists('next.config.js') || fileExists('next.config.mjs') || fileExists('next.config.ts')) return 'nextjs';
  if (hasDependency(packageJson, ['express', 'fastify', '@nestjs/core', 'hono', 'koa'])) return 'node-api';
  if (fileExists('pyproject.toml') || fileExists('requirements.txt') || fileExists('uv.lock') || fileExists('poetry.lock') || fileExists('Pipfile')) return 'python-api';
  if (hasDependency(packageJson, ['react-native', 'expo']) || fileExists('pubspec.yaml') || fileExists('ios') || fileExists('android')) return 'mobile';

  return null;
}

function resolveProfile(profile: string): { status: 'ok' | 'none' | 'invalid' | 'unknown'; profile: string; detail: string } {
  const normalized = normalizeProfile(profile);
  if (normalized === 'base' || normalized === 'none') {
    return { status: 'none', profile: 'base', detail: 'base harness only' };
  }

  const resolvedProfile = normalized === 'auto' ? detectProjectProfile() : normalized;
  if (!resolvedProfile) {
    return { status: 'unknown', profile: 'base', detail: 'auto profile could not detect a supported stack' };
  }

  const availableProfiles = getAvailableProfiles();
  if (!availableProfiles.includes(resolvedProfile)) {
    return {
      status: 'invalid',
      profile: resolvedProfile,
      detail: `unknown profile "${resolvedProfile}". Available profiles: ${availableProfiles.join(', ') || 'none'}`
    };
  }

  return { status: 'ok', profile: resolvedProfile, detail: normalized === 'auto' ? `auto detected ${resolvedProfile}` : resolvedProfile };
}

function createManifest(profile: string): HarnessManifest {
  return {
    version: 1,
    package: packageName,
    package_version: getPackageVersion(),
    profile,
    initialized_at: new Date().toISOString()
  };
}

function writeManifest(profile: string): void {
  const relativePath = '.ai/manifest.json';
  const destination = path.join(root, relativePath);
  const content = `${JSON.stringify(createManifest(profile), null, 2)}\n`;

  if (dryRun) {
    console.log(`would create ${relativePath}`);
    return;
  }

  if (fs.existsSync(destination) && !force && !upgrade) {
    console.log(`skip ${relativePath} already exists. Use --force or --upgrade to overwrite.`);
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  console.log(`created ${relativePath}`);
}

function readManifest(): HarnessManifest | null {
  return readJsonFileIfPresent<HarnessManifest>(path.join(root, '.ai', 'manifest.json'));
}

function usage(): string {
  return `Usage:
  forgeai-init [--dry-run] [--force] [--profile <name|auto>]
  forgeai-init --upgrade
  forgeai-init --check
  forgeai-init --check-updates
  forgeai-init --check-git
  forgeai-init --check-sessions
  forgeai-init --check-lifecycle
  forgeai-init --check-codegraph
  forgeai-init --check-profile
  forgeai-init --list-profiles
  forgeai-init --version
  forgeai-init --help

Options:
  --dry-run     Print files that would be created without writing them.
  --force       Overwrite existing harness files during initialization.
  --upgrade     Overwrite installed ForgeAI harness files with this package version.
  --profile     Apply an optional stack profile: auto, nextjs, node-api, tauri, monorepo, python-api, or mobile.
  --check       Validate installed ForgeAI harness files and model adapters.
  --check-updates
                Check npm for the latest ForgeAI version, even in non-interactive mode.
  --check-git   Validate git branch, worktree, remote, hooks, and PR/MR tooling.
  --check-sessions
                Validate active agent sessions for overlapping write scopes.
  --check-lifecycle
                Validate lifecycle state files and task journals.
  --check-codegraph
                Validate CodeGraph artifacts for graph-guided context selection.
  --check-profile
                Validate the installed profile against detected project signals.
  --skip-update-check
                Skip the npm latest-version preflight check.
  --list-profiles
                Print supported profile names.
  --version     Print the package version.
  --help        Print this help text.
`;
}

function shouldRunUpdateCheck(): boolean {
  if (skipUpdateCheck) return false;
  if (help || version || listProfiles) return false;
  if (process.env.CI === 'true') return false;
  if (!checkUpdates && !isInteractiveTerminal() && !process.env.FORGEAI_TEST_LATEST_VERSION) return false;
  return true;
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function promptUpdateChoice(latestVersion: string): 'skip' | 'update' {
  console.log('');
  console.log(`ForgeAI ${latestVersion} is available.`);
  console.log('Choose an option:');
  console.log('  1. Skip for now');
  console.log('  2. Update the ForgeAI harness to latest');
  process.stdout.write('Select 1 or 2: ');

  const buffer = Buffer.alloc(32);
  const bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
  const choice = buffer.subarray(0, bytesRead).toString('utf8').trim();
  return choice === '2' ? 'update' : 'skip';
}

function rerunWithLatest(): void {
  const result = spawnSync('npx', [`${packageName}@latest`, '--upgrade', '--skip-update-check'], {
    cwd: root,
    env: { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' },
    stdio: 'inherit'
  });

  process.exit(result.status ?? 1);
}

function runUpdatePreflight(): void {
  if (!shouldRunUpdateCheck()) return;

  const currentVersion = getPackageVersion();
  const manifest = readManifest();
  const installedVersion = manifest?.package_version;
  const latest = getLatestPackageVersion();

  if (!latest.version) {
    if (isInteractiveTerminal()) {
      console.log(formatStatus('update skipped', `could not check latest ${packageName} version${latest.error ? ` (${latest.error})` : ''}`));
    }
    return;
  }

  const currentIsOutdated = compareSemver(currentVersion, latest.version) < 0;
  const installedIsOutdated = installedVersion ? compareSemver(installedVersion, latest.version) < 0 : false;
  if (!currentIsOutdated && !installedIsOutdated) return;

  console.log('ForgeAI update check');
  console.log(formatStatus(installedVersion && installedIsOutdated ? 'outdated' : 'ok', `installed harness: ${installedVersion ?? 'not installed yet'}`));
  console.log(formatStatus(currentIsOutdated ? 'outdated' : 'ok', `current CLI: ${currentVersion}`));
  console.log(formatStatus('latest', `${packageName}@${latest.version}`));

  if (!isInteractiveTerminal()) {
    console.log(`Recommendation: ask the human to run npx ${packageName}@latest --upgrade, or skip this update for now.`);
    console.log('');
    return;
  }

  if (promptUpdateChoice(latest.version) === 'update') rerunWithLatest();
  console.log('Skipping update for now.');
  console.log('');
}

function runCommand(command: string, commandArgs: string[], cwd = root): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function runGit(commandArgs: string[]): { status: number | null; stdout: string; stderr: string } {
  return runCommand('git', commandArgs);
}

function firstNonEmptyLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function cleanTableCell(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^`|`$/g, '')
    .trim();
}

function parseScopeList(value: string): string[] {
  const cleaned = cleanTableCell(value);
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'none') return [];

  return cleaned
    .split(/,|<br\s*\/?>/i)
    .map((item) => cleanTableCell(item))
    .filter(Boolean);
}

function normalizeScopePath(scope: string): string {
  const trimmed = scope
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');

  if (trimmed === '/') return '.';
  return trimmed.replace(/\/+$/, '') || '.';
}

function isBroadScope(scope: string): boolean {
  const normalized = normalizeScopePath(scope).toLowerCase();
  return normalized === '.' || normalized === '*' || normalized === 'repo' || normalized === 'all' || normalized.includes('*');
}

function scopesOverlap(left: string, right: string): boolean {
  const leftPath = normalizeScopePath(left);
  const rightPath = normalizeScopePath(right);

  if (isBroadScope(leftPath) || isBroadScope(rightPath)) return true;
  if (leftPath === rightPath) return true;
  if (leftPath.startsWith(`${rightPath}/`)) return true;
  if (rightPath.startsWith(`${leftPath}/`)) return true;
  return false;
}

function parseSessionTable(content: string): AgentSession[] {
  const sessions: AgentSession[] = [];
  let inActiveSessions = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      inActiveSessions = /^##\s+Active Sessions\b/i.test(line);
      continue;
    }

    if (!inActiveSessions || !line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line) || /\|\s*ID\s*\|/i.test(line)) continue;

    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());

    if (cells.length < 9) continue;

    const id = cleanTableCell(cells[0]);
    if (!id || id === 'example-session') continue;

    sessions.push({
      id,
      owner: cleanTableCell(cells[1]),
      task: cleanTableCell(cells[2]),
      branch: cleanTableCell(cells[3]),
      status: cleanTableCell(cells[4]).toLowerCase(),
      started: cleanTableCell(cells[5]),
      readScope: parseScopeList(cells[6]),
      writeScope: parseScopeList(cells[7]),
      notes: cleanTableCell(cells[8])
    });
  }

  return sessions;
}

function isUnfinishedSession(session: AgentSession): boolean {
  return !['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled'].includes(session.status);
}

function runCheckSessions(): void {
  console.log('ForgeAI session check');
  console.log('');

  const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');
  if (!fs.existsSync(sessionsPath)) {
    console.log(formatStatus('missing', '.ai/state/sessions.md'));
    console.log('');
    console.log('Result: session coordination file missing. Run forgeai-init --upgrade to install it.');
    process.exitCode = 1;
    return;
  }

  const sessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8'));
  const unfinished = sessions.filter(isUnfinishedSession);

  if (sessions.length === 0) {
    console.log(formatStatus('ok', 'no real sessions recorded'));
    console.log('');
    console.log('Result: no active session overlap detected.');
    return;
  }

  for (const session of sessions) {
    const writeScope = session.writeScope.length > 0 ? session.writeScope.join(', ') : 'missing';
    const status = isUnfinishedSession(session) ? 'active' : 'closed';
    console.log(formatStatus(status, `${session.id} ${session.status || 'unknown'} write: ${writeScope}`));
  }

  let collisions = 0;
  let missingWriteScopes = 0;

  for (const session of unfinished) {
    if (session.writeScope.length === 0) {
      missingWriteScopes += 1;
      console.log(formatStatus('invalid', `${session.id} has no write scope`));
    }
  }

  for (let leftIndex = 0; leftIndex < unfinished.length; leftIndex += 1) {
    const left = unfinished[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < unfinished.length; rightIndex += 1) {
      const right = unfinished[rightIndex];
      for (const leftScope of left.writeScope) {
        const overlappingScope = right.writeScope.find((rightScope) => scopesOverlap(leftScope, rightScope));
        if (!overlappingScope) continue;
        collisions += 1;
        console.log(
          formatStatus(
            'overlap',
            `${left.id} (${normalizeScopePath(leftScope)}) conflicts with ${right.id} (${normalizeScopePath(overlappingScope)})`
          )
        );
        break;
      }
    }
  }

  console.log('');
  if (missingWriteScopes > 0 || collisions > 0) {
    console.log('Result: active sessions need coordination before parallel agent work continues.');
    process.exitCode = 1;
    return;
  }

  if (unfinished.length === 0) {
    console.log('Result: no active sessions.');
    return;
  }

  console.log('Result: active sessions have disjoint write scopes.');
}

function extractBulletValue(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^-\\s+${escaped}:\\s*(.+)$`, 'im'));
  return cleanTableCell(match?.[1]);
}

function isChecked(content: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^-\\s+\\[[xX]\\]\\s+${escaped}\\s*$`, 'm').test(content);
}

function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function daysSince(date: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function isClosedLifecycleState(state: string): boolean {
  return state === 'closed';
}

function isTerminalLifecycleState(state: string): boolean {
  return ['closed', 'cancelled', 'canceled'].includes(state);
}

function listTaskJournalFiles(): string[] {
  const tasksDir = path.join(root, '.ai', 'state', 'tasks');
  if (!fs.existsSync(tasksDir)) return [];

  return fs
    .readdirSync(tasksDir)
    .filter((fileName) => fileName.endsWith('.md') && fileName !== '_template.md')
    .map((fileName) => `.ai/state/tasks/${fileName}`)
    .sort();
}

function parseTaskJournal(relativePath: string): TaskJournal {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return {
    file: relativePath,
    taskId: extractBulletValue(content, 'Task ID'),
    taskType: extractBulletValue(content, 'Task type').toLowerCase(),
    currentState: extractBulletValue(content, 'Current state').toLowerCase(),
    lastUpdated: extractBulletValue(content, 'Last updated'),
    staleStatus: extractBulletValue(content, 'Stale status').toLowerCase(),
    memoryUpdateChecked: isChecked(content, 'Update `.ai/MEMORY.md`'),
    noMemoryUpdateChecked: isChecked(content, 'No memory update needed')
  };
}

function runCheckLifecycle(): void {
  console.log('ForgeAI lifecycle check');
  console.log('');

  const requiredLifecycleFiles = ['.ai/state/lifecycle.md', '.ai/state/tasks/_template.md', '.ai/workflows/lifecycle-management.md'];
  let failures = 0;
  let staleTasks = 0;

  for (const relativePath of requiredLifecycleFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const taskFiles = listTaskJournalFiles();
  console.log('');
  console.log('Task journals');

  if (taskFiles.length === 0) {
    console.log(formatStatus('ok', 'no real task journals recorded'));
  }

  for (const taskFile of taskFiles) {
    const journal = parseTaskJournal(taskFile);
    const label = `${taskFile}${journal.taskId ? ` (${journal.taskId})` : ''}`;
    let journalFailures = 0;

    if (!journal.taskId || journal.taskId === 'TASK-YYYYMMDD-short-slug' || journal.taskId === 'TASK-...') {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} missing real Task ID`));
    }

    if (!taskTypes.includes(journal.taskType)) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid task type: ${journal.taskType || 'missing'}`));
    }

    if (!lifecycleStates.includes(journal.currentState)) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid lifecycle state: ${journal.currentState || 'missing'}`));
    }

    const lastUpdated = parseDateOnly(journal.lastUpdated);
    if (!lastUpdated) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${taskFile} has invalid Last updated: ${journal.lastUpdated || 'missing'}`));
    } else if (!isTerminalLifecycleState(journal.currentState)) {
      const ageDays = daysSince(lastUpdated);
      if (ageDays > 7) {
        staleTasks += 1;
        const status = journal.staleStatus === 'stale' ? 'stale' : 'needs refresh';
        console.log(formatStatus(status, `${taskFile} last updated ${ageDays} days ago`));
      }
    }

    if (isClosedLifecycleState(journal.currentState)) {
      const memoryDecisions = Number(journal.memoryUpdateChecked) + Number(journal.noMemoryUpdateChecked);
      if (memoryDecisions !== 1) {
        journalFailures += 1;
        console.log(formatStatus('invalid', `${taskFile} closed without exactly one memory update decision`));
      }
    }

    if (journalFailures === 0) {
      const state = isClosedLifecycleState(journal.currentState) ? 'closed' : 'active';
      console.log(formatStatus(state, `${label} state: ${journal.currentState}`));
    }

    failures += journalFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: lifecycle journals need fixes before reliable agent handoff.');
    process.exitCode = 1;
    return;
  }

  if (staleTasks > 0) {
    console.log('Result: lifecycle journals have stale active work. Refresh assumptions and validation before resuming.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: lifecycle state is usable.');
}

function isTodoValue(value: unknown): boolean {
  return typeof value === 'string' && /\bTODO\b/i.test(value);
}

function isTemplateCodeGraph(graph: CodeGraph): boolean {
  return isTodoValue(graph.generated_at) || isTodoValue(graph.source) || graph.nodes?.some((node) => isTodoValue(node.id) || isTodoValue(node.path)) === true;
}

function isValidConfidence(value: string | undefined): boolean {
  return value === 'high' || value === 'medium' || value === 'low';
}

function runCheckCodeGraph(): void {
  console.log('ForgeAI CodeGraph check');
  console.log('');

  const requiredCodeGraphFiles = [
    '.ai/codegraph/README.md',
    '.ai/codegraph/graph.json',
    '.ai/codegraph/hotspots.md',
    '.ai/codegraph/context-packs/_template.md',
    '.ai/workflows/codegraph-context.md'
  ];
  let failures = 0;

  for (const relativePath of requiredCodeGraphFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const graphPath = path.join(root, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('');
    console.log('Result: CodeGraph artifacts are incomplete. Run forgeai-init --upgrade to install them.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Graph metadata');

  let graph: CodeGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as CodeGraph;
  } catch (error) {
    console.log(formatStatus('invalid', `.ai/codegraph/graph.json (${getErrorMessage(error)})`));
    console.log('');
    console.log('Result: CodeGraph JSON is invalid.');
    process.exitCode = 1;
    return;
  }

  if (isTemplateCodeGraph(graph)) {
    console.log(formatStatus('needs bootstrap', '.ai/codegraph/graph.json still contains template TODOs'));
    console.log(formatStatus('next', 'populate graph.json before using CodeGraph for risky edits'));
    console.log('');
    console.log('Result: CodeGraph installed, but repository graph still needs bootstrap.');
    return;
  }

  if (graph.schema_version !== 1) {
    failures += 1;
    console.log(formatStatus('invalid', `schema_version must be 1, got ${graph.schema_version ?? 'missing'}`));
  } else {
    console.log(formatStatus('ok', 'schema_version: 1'));
  }

  const generatedAt = parseDateOnly(graph.generated_at ?? '');
  if (!generatedAt) {
    failures += 1;
    console.log(formatStatus('invalid', `generated_at must be YYYY-MM-DD, got ${graph.generated_at ?? 'missing'}`));
  } else {
    const ageDays = daysSince(generatedAt);
    const status = ageDays > 30 ? 'stale' : 'ok';
    if (ageDays > 30) failures += 1;
    console.log(formatStatus(status, `generated_at: ${graph.generated_at} (${ageDays} days old)`));
  }

  if (!graph.source) {
    failures += 1;
    console.log(formatStatus('invalid', 'source is required'));
  } else {
    console.log(formatStatus('ok', `source: ${graph.source}`));
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (!Array.isArray(graph.nodes) || nodes.length === 0) {
    failures += 1;
    console.log(formatStatus('invalid', 'nodes must contain at least one module'));
  } else {
    console.log(formatStatus('ok', `${nodes.length} graph node${nodes.length === 1 ? '' : 's'}`));
  }

  if (!Array.isArray(graph.edges)) {
    failures += 1;
    console.log(formatStatus('invalid', 'edges must be an array'));
  } else {
    console.log(formatStatus('ok', `${edges.length} graph edge${edges.length === 1 ? '' : 's'}`));
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const label = node.id || `node[${index}]`;
    let nodeFailures = 0;

    if (!node.id) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `node[${index}] missing id`));
    } else if (nodeIds.has(node.id)) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${node.id} is duplicated`));
    } else {
      nodeIds.add(node.id);
    }

    if (!node.path) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing path`));
    }
    if (!node.summary) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing summary`));
    }
    if (!isValidConfidence(node.confidence)) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} confidence must be high, medium, or low`));
    }

    failures += nodeFailures;
  }

  for (const [index, edge] of edges.entries()) {
    const label = `edge[${index}]`;
    let edgeFailures = 0;

    if (!edge.from || !nodeIds.has(edge.from)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} references missing from node: ${edge.from ?? 'missing'}`));
    }
    if (!edge.to || !nodeIds.has(edge.to)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} references missing to node: ${edge.to ?? 'missing'}`));
    }
    if (!edge.kind) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing kind`));
    }
    if (!isValidConfidence(edge.confidence)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} confidence must be high, medium, or low`));
    }

    failures += edgeFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: CodeGraph needs fixes before graph-guided context selection is reliable.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: CodeGraph is usable for graph-guided context selection.');
}

function detectProvider(remoteUrl: string | null): string {
  if (!remoteUrl) return 'none';
  if (/github\.com[:/]/i.test(remoteUrl)) return 'github';
  if (/gitlab\.com[:/]/i.test(remoteUrl)) return 'gitlab';
  if (/bitbucket\.org[:/]/i.test(remoteUrl)) return 'bitbucket';
  return 'unknown';
}

function detectRemote(): { name: string | null; url: string | null } {
  const origin = runGit(['remote', 'get-url', 'origin']);
  if (origin.status === 0) return { name: 'origin', url: origin.stdout.trim() };

  const remotes = runGit(['remote']);
  const remoteName = firstNonEmptyLine(remotes.stdout);
  if (!remoteName) return { name: null, url: null };

  const remoteUrl = runGit(['remote', 'get-url', remoteName]);
  return {
    name: remoteName,
    url: remoteUrl.status === 0 ? remoteUrl.stdout.trim() : null
  };
}

function detectBaseBranch(remoteName: string | null): string | null {
  if (remoteName) {
    const remoteHead = runGit(['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`]);
    if (remoteHead.status === 0) return remoteHead.stdout.trim();

    for (const branch of ['main', 'master', 'develop']) {
      const ref = `${remoteName}/${branch}`;
      if (runGit(['rev-parse', '--verify', '--quiet', ref]).status === 0) return ref;
    }
  }

  for (const branch of ['main', 'master', 'develop']) {
    if (runGit(['rev-parse', '--verify', '--quiet', branch]).status === 0) return branch;
  }

  return null;
}

function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master' || branch === 'production' || branch.startsWith('release/');
}

function branchNamingStatus(branch: string | null): { status: string; detail: string } {
  if (!branch) return { status: 'detached', detail: 'HEAD is detached' };
  if (isProtectedBranch(branch)) return { status: 'protected', detail: `${branch} should not be used for agent work` };

  const valid = /^(feat|fix|docs|refactor|test|chore|perf|ci|build)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(branch);
  return valid
    ? { status: 'ok', detail: branch }
    : { status: 'invalid', detail: `${branch} should use feat/, fix/, docs/, refactor/, test/, chore/, perf/, ci/, or build/` };
}

function detectHooks(): string[] {
  const hooks: string[] = [];
  if (fs.existsSync(path.join(root, '.husky'))) hooks.push('husky');
  if (fs.existsSync(path.join(root, '.pre-commit-config.yaml'))) hooks.push('pre-commit');
  if (fs.existsSync(path.join(root, 'lefthook.yml')) || fs.existsSync(path.join(root, 'lefthook.yaml'))) hooks.push('lefthook');

  const hooksPath = runGit(['config', '--get', 'core.hooksPath']);
  if (hooksPath.status === 0 && hooksPath.stdout.trim()) hooks.push(`core.hooksPath=${hooksPath.stdout.trim()}`);

  try {
    const packageJson = readJsonIfPresent<{ scripts?: Record<string, string>; 'lint-staged'?: unknown }>('package.json');
    if (packageJson?.['lint-staged']) hooks.push('lint-staged');
    if (packageJson?.scripts?.['lint-staged']) hooks.push('lint-staged script');
    if (packageJson?.scripts?.prepare?.includes('husky')) hooks.push('husky prepare');
  } catch {
    // Invalid package.json is reported elsewhere by project validation.
  }

  return [...new Set(hooks)];
}

function detectConflictRisk(baseBranch: string | null, hasRemote: boolean): { status: string; detail: string } {
  if (!baseBranch) return { status: 'unknown', detail: hasRemote ? 'base branch not found locally; run git fetch' : 'no local base branch found' };

  const baseExists = runGit(['rev-parse', '--verify', '--quiet', baseBranch]);
  if (baseExists.status !== 0) return { status: 'needs fetch', detail: `${baseBranch} is not available locally` };

  const mergeBase = runGit(['merge-base', 'HEAD', baseBranch]);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.status !== 0 || !mergeBaseSha) return { status: 'unknown', detail: `cannot compute merge-base with ${baseBranch}` };

  const mergeTree = runGit(['merge-tree', mergeBaseSha, 'HEAD', baseBranch]);
  if (mergeTree.status !== 0) return { status: 'unknown', detail: mergeTree.stderr.trim() || 'git merge-tree failed' };

  const hasConflict = /<<<<<<<|=======|>>>>>>>/.test(mergeTree.stdout);
  return hasConflict
    ? { status: 'conflict', detail: `merge with ${baseBranch} has conflicts` }
    : { status: 'clean', detail: `no local merge conflict detected against ${baseBranch}` };
}

function detectPrTool(provider: string): { status: string; detail: string } {
  if (provider === 'github') return commandExists('gh') ? { status: 'available', detail: 'gh' } : { status: 'missing', detail: 'install/login gh or create PR manually' };
  if (provider === 'gitlab') return commandExists('glab') ? { status: 'available', detail: 'glab' } : { status: 'missing', detail: 'install/login glab or create MR manually' };
  if (provider === 'bitbucket') return commandExists('bb') ? { status: 'available', detail: 'bb' } : { status: 'manual', detail: 'Bitbucket CLI not configured; create PR manually or configure bb' };
  if (provider === 'none') return { status: 'none', detail: 'no remote connected; keep work local' };
  return { status: 'unknown', detail: 'provider-specific PR/MR tool not configured' };
}

function runCheckGit(): void {
  console.log('ForgeAI git check');
  console.log('');

  if (!commandExists('git')) {
    console.log(formatStatus('missing', 'git command is not available'));
    console.log('');
    console.log('Result: git unavailable. Install git before using worktree or branch checks.');
    process.exitCode = 1;
    return;
  }

  const insideRepo = runGit(['rev-parse', '--is-inside-work-tree']);
  if (insideRepo.status !== 0 || insideRepo.stdout.trim() !== 'true') {
    console.log(formatStatus('missing', 'not inside a git worktree'));
    console.log('');
    console.log('Result: git repository not found. Run git init or connect a repository before branch/worktree checks.');
    process.exitCode = 1;
    return;
  }

  const topLevel = runGit(['rev-parse', '--show-toplevel']).stdout.trim();
  const currentBranchOutput = runGit(['branch', '--show-current']);
  const currentBranch = currentBranchOutput.stdout.trim() || null;
  const remote = detectRemote();
  const provider = detectProvider(remote.url);
  const baseBranch = detectBaseBranch(remote.name);
  const status = runGit(['status', '--porcelain']);
  const isDirty = status.stdout.trim().length > 0;
  const branchStatus = branchNamingStatus(currentBranch);
  const hooks = detectHooks();
  const conflictRisk = detectConflictRisk(baseBranch, Boolean(remote.name));
  const prTool = detectPrTool(provider);

  console.log('Repository');
  console.log(formatStatus('ok', topLevel || root));
  console.log(formatStatus(provider === 'none' ? 'none' : 'ok', `provider: ${provider}`));
  console.log(formatStatus(remote.name ? 'ok' : 'none', `remote: ${remote.name ? `${remote.name} ${remote.url ?? ''}` : 'not configured'}`));
  console.log(formatStatus(baseBranch ? 'ok' : 'unknown', `base branch: ${baseBranch ?? 'not detected'}`));
  console.log(formatStatus(currentBranch ? 'ok' : 'detached', `current branch: ${currentBranch ?? 'detached HEAD'}`));

  console.log('');
  console.log('Branch and worktree');
  console.log(formatStatus(branchStatus.status, branchStatus.detail));
  console.log(formatStatus(isDirty ? 'dirty' : 'clean', isDirty ? 'working tree has local changes' : 'working tree has no local changes'));
  console.log(formatStatus(conflictRisk.status, conflictRisk.detail));

  console.log('');
  console.log('Hooks and review');
  console.log(formatStatus(hooks.length > 0 ? 'detected' : 'none', hooks.length > 0 ? hooks.join(', ') : 'no local git hooks detected'));
  console.log(formatStatus(prTool.status, `PR/MR tool: ${prTool.detail}`));

  console.log('');
  if (provider === 'none') {
    console.log('Recommendation: no remote is connected. Keep work local, use a semantic branch, and do not push or create a PR/MR until a remote is configured.');
  } else if (prTool.status === 'missing' || prTool.status === 'manual') {
    console.log('Recommendation: finish local validation, then authenticate/configure the provider tool or create the PR/MR manually.');
  } else {
    console.log('Recommendation: validate locally, push the semantic branch, then create the PR/MR with the detected provider tool.');
  }

  if (branchStatus.status === 'invalid' || branchStatus.status === 'protected' || conflictRisk.status === 'conflict') {
    process.exitCode = 1;
    console.log('Result: git workflow needs attention before agent work is ready for review.');
    return;
  }

  console.log('Result: git workflow is usable.');
}

function runCheck(): void {
  console.log('ForgeAI harness check');
  console.log('');

  let missingRequired = 0;
  for (const relativePath of requiredHarnessFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) missingRequired += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  console.log('');
  console.log('Bootstrap status');
  let totalTodos = 0;
  for (const relativePath of bootstrapFiles) {
    const todos = countTodos(relativePath);
    totalTodos += todos;
    const status = todos > 0 ? 'needs bootstrap' : 'ok';
    console.log(formatStatus(status, `${relativePath}${todos > 0 ? ` (${todos} TODO)` : ''}`));
  }

  console.log('');
  console.log('Model adapters');
  const availableAdapters: string[] = [];
  let adapterReadFailed = false;

  try {
    const adapterConfig = readJsonIfPresent<AdapterConfig>('.ai/cli-adapters.json');
    const adapters = adapterConfig?.adapters || {};
    const adapterEntries = Object.entries(adapters);

    if (adapterEntries.length === 0) {
      console.log(formatStatus('skipped', '.ai/cli-adapters.json has no adapters'));
    }

    for (const [provider, adapter] of adapterEntries) {
      const available = commandExists(adapter.command);
      if (available) availableAdapters.push(provider);
      console.log(
        formatStatus(
          available ? 'optional ok' : 'optional missing',
          `${provider} (${adapter.command ?? 'missing command'})`
        )
      );
    }
  } catch (error) {
    adapterReadFailed = true;
    console.log(formatStatus('invalid', `.ai/cli-adapters.json (${getErrorMessage(error)})`));
  }

  console.log('');
  console.log('Orchestration');
  if (availableAdapters.length === 0) {
    console.log(formatStatus('single-agent', 'current model must orchestrate, implement, review, and validate locally'));
  } else {
    console.log(formatStatus('multi-agent', `orchestrator can be current model or: ${availableAdapters.join(', ')}`));
    console.log(formatStatus('policy', 'human chooses orchestrator; fallback is current_model_executes_locally'));
  }

  console.log('');
  console.log('Session coordination');
  const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');
  if (!fs.existsSync(sessionsPath)) {
    console.log(formatStatus('missing', '.ai/state/sessions.md'));
    missingRequired += 1;
  } else {
    const unfinishedSessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8')).filter(isUnfinishedSession);
    console.log(formatStatus('ok', `.ai/state/sessions.md (${unfinishedSessions.length} active)`));
    console.log(formatStatus('check', 'run forgeai-init --check-sessions before parallel agent work'));
  }

  console.log('');
  if (missingRequired > 0 || adapterReadFailed) {
    console.log('Result: harness incomplete. Run forgeai-init or restore the missing/invalid files.');
    process.exitCode = 1;
    return;
  }

  if (totalTodos > 0) {
    console.log('Result: harness installed, but project context still needs bootstrap.');
    return;
  }

  console.log('Result: harness installed and ready.');
}

function runCheckProfile(): void {
  console.log('ForgeAI profile check');
  console.log('');

  const manifest = readManifest();
  const installedProfile = manifest?.profile ?? 'base';
  const detectedProfile = detectProjectProfile();
  const availableProfiles = getAvailableProfiles();

  console.log(formatStatus(manifest ? 'ok' : 'missing', manifest ? `.ai/manifest.json profile: ${installedProfile}` : '.ai/manifest.json'));
  console.log(formatStatus(detectedProfile ? 'detected' : 'unknown', detectedProfile ?? 'no supported stack profile detected'));
  console.log(formatStatus('available', availableProfiles.join(', ') || 'none'));

  if (!manifest) {
    console.log('');
    console.log('Result: profile unknown. Re-run forgeai-init with --profile <name> or --profile auto to create a manifest.');
    process.exitCode = 1;
    return;
  }

  if (installedProfile === 'base') {
    console.log('');
    console.log('Result: base harness installed. Run forgeai-init --profile <name> to add stack-specific guidance if needed.');
    return;
  }

  const installedProfilePath = profilePath(installedProfile);
  if (!fs.existsSync(installedProfilePath)) {
    console.log(formatStatus('invalid', `installed profile ${installedProfile} is not supported by this package version`));
    console.log('');
    console.log('Result: installed profile is not recognized.');
    process.exitCode = 1;
    return;
  }

  const requiredProfileFiles = listFilesRecursive(installedProfilePath);
  let missingProfileFiles = 0;
  for (const relativePath of requiredProfileFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) missingProfileFiles += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  if (detectedProfile && detectedProfile !== installedProfile) {
    console.log('');
    console.log(`Result: profile mismatch. Installed ${installedProfile}, but project signals look like ${detectedProfile}.`);
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
}

// Files/dirs that hold project- or run-specific content populated by the
// agent or human. On --upgrade they are preserved if they already exist so an
// upgrade never clobbers a populated CodeGraph, project context, or run state.
const PRESERVE_ON_UPGRADE_FILES = new Set([
  '.ai/PROJECT.md',
  '.ai/MEMORY.md',
  '.ai/AGENT_REGISTRY.md',
  '.ai/codegraph/graph.json',
  '.ai/codegraph/hotspots.md'
]);
const PRESERVE_ON_UPGRADE_DIRS = ['.ai/state'];

function isPreservedOnUpgrade(dest: string): boolean {
  const relative = path.relative(root, dest).split(path.sep).join('/');
  if (PRESERVE_ON_UPGRADE_FILES.has(relative)) return true;
  return PRESERVE_ON_UPGRADE_DIRS.some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!dryRun) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dest, item));
    return;
  }
  if (fs.existsSync(dest)) {
    if (upgrade && isPreservedOnUpgrade(dest)) {
      console.log(`preserved ${path.relative(root, dest)}`);
      return;
    }
    if (!force && !upgrade) {
      console.log(`skip ${path.relative(root, dest)} already exists. Use --force or --upgrade to overwrite.`);
      return;
    }
  }
  if (dryRun) console.log(`would create ${path.relative(root, dest)}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`created ${path.relative(root, dest)}`);
  }
}

runUpdatePreflight();

if (help) console.log(usage());
else if (version) console.log(getPackageVersion());
else if (listProfiles) console.log(['base', ...getAvailableProfiles()].join('\n'));
else if (checkGit) runCheckGit();
else if (checkSessions) runCheckSessions();
else if (checkLifecycle) runCheckLifecycle();
else if (checkCodeGraph) runCheckCodeGraph();
else if (checkProfile) runCheckProfile();
else if (check) runCheck();
else if (checkUpdates) console.log('Update check complete.');
else {
  const manifestProfile = readManifest()?.profile;
  const profile = resolveProfile(upgrade ? (manifestProfile ?? requestedProfile) : requestedProfile);
  if (profile.status === 'invalid') {
    console.error(profile.detail);
    process.exitCode = 1;
  } else {
    copyRecursive(templateDir, root);
    if (profile.status === 'ok') {
      copyRecursive(profilePath(profile.profile), root);
    } else if (requestedProfile === 'auto' && profile.status === 'unknown') {
      console.log(`profile auto skipped: ${profile.detail}`);
    }
    writeManifest(profile.profile);
    console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');
  }
}
