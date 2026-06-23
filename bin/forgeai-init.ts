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

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const help = args.has('--help') || args.has('-h');
const version = args.has('--version') || args.has('-v');
const force = args.has('--force');
const dryRun = args.has('--dry-run');
const check = args.has('--check');
const checkGit = args.has('--check-git');
const checkProfile = args.has('--check-profile');
const listProfiles = args.has('--list-profiles');
const requestedProfile = getArgValue('--profile') ?? 'base';

const requiredHarnessFiles = listFilesRecursive(templateDir);

const bootstrapFiles = ['.ai/PROJECT.md', '.ai/MEMORY.md', '.ai/AGENT_REGISTRY.md'];

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
  return readJsonIfPresent<PackageJson>('package.json');
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
    package: 'forgeai-agentic-init',
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

  if (fs.existsSync(destination) && !force) {
    console.log(`skip ${relativePath} already exists. Use --force to overwrite.`);
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
  forgeai-init --check
  forgeai-init --check-git
  forgeai-init --check-profile
  forgeai-init --list-profiles
  forgeai-init --version
  forgeai-init --help

Options:
  --dry-run     Print files that would be created without writing them.
  --force       Overwrite existing harness files during initialization.
  --profile     Apply an optional stack profile: auto, nextjs, node-api, tauri, monorepo, python-api, or mobile.
  --check       Validate installed ForgeAI harness files and model adapters.
  --check-git   Validate git branch, worktree, remote, hooks, and PR/MR tooling.
  --check-profile
                Validate the installed profile against detected project signals.
  --list-profiles
                Print supported profile names.
  --version     Print the package version.
  --help        Print this help text.
`;
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

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!dryRun) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dest, item));
    return;
  }
  if (fs.existsSync(dest) && !force) {
    console.log(`skip ${path.relative(root, dest)} already exists. Use --force to overwrite.`);
    return;
  }
  if (dryRun) console.log(`would create ${path.relative(root, dest)}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`created ${path.relative(root, dest)}`);
  }
}

if (help) console.log(usage());
else if (version) console.log(getPackageVersion());
else if (listProfiles) console.log(['base', ...getAvailableProfiles()].join('\n'));
else if (checkGit) runCheckGit();
else if (checkProfile) runCheckProfile();
else if (check) runCheck();
else {
  const profile = resolveProfile(requestedProfile);
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
