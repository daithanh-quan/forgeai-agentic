import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { root, rawArgs, getArgValue, validateArgFlag } from './context.js';
import { generateDependencyGraph } from './dependency-graph.js';
import { getErrorMessage, formatStatus, isValidTaskId } from './utils.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { resolveExclusions } from './profile-exclusions.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph, type SelectedContextNode } from './context-pack.js';
import { formatTryOutput, buildTryReport, parseTryObjective, detectCtaState } from './try.js';
import { compileContext, renderCompiledContextMarkdown } from './context-compiler.js';
import { routeToAdapter } from './router.js';
import { createTaskReport, writeTaskReport } from './task-report.js';
import type { Adapter, AdapterConfig, CompiledContextArtifact, DependencyGraph } from './types.js';

const CONTEXT_DIR = '.ai/state/context';
const ROUTE_JOURNAL = '.ai/state/context-routes.md';
const DEFAULT_BUDGET = 6000;
const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_DEPTH = 2;
const MAX_OUTPUT_LINES = 20;

export type TaskValidationResult = {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
};

export type TaskSafetySnapshot = {
  gitPaths: Set<string>;
  aiFiles: Map<string, string>;
  sourceFiles: Map<string, string>;
  scopes: string[];
};

export function parseTaskObjective(args: string[]): string | null {
  if (validateArgFlag('--objective', args) !== null) return null;
  const flagged = parseTryObjective(args);
  if (flagged) return flagged;

  const valueFlags = new Set(['--adapter', '--model', '--task', '--budget', '--max-depth', '--max-nodes', '--write-scope', '--tier']);
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--dry-run' || value === '--yes') continue;
    if (valueFlags.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith('--')) continue;
    return value;
  }
  return null;
}

function adapterNames(files: string[]): string[] {
  const names: string[] = [];
  for (const file of files) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = (value as { adapters?: unknown }).adapters;
        if (entries && typeof entries === 'object' && !Array.isArray(entries)) names.push(...Object.keys(entries));
      }
    } catch { /* not initialized or malformed */ }
  }
  return [...new Set(names)].sort();
}

function configuredAdapters(): string[] {
  return adapterNames(['.ai/cli-adapters.json', '.ai/api-adapters.json']);
}

function configuredCliAdapters(): string[] {
  return adapterNames(['.ai/cli-adapters.json']);
}

type AdapterAvailability = 'available' | 'unavailable' | 'unknown';

function checkCliAdapter(name: string): AdapterAvailability {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.ai/cli-adapters.json'), 'utf8')) as AdapterConfig;
    const adapter = raw.adapters?.[name] as Adapter | undefined;
    if (!adapter?.command) return 'unavailable';
    if (!adapter.healthcheck) return 'unknown';
    const result = spawnSync(adapter.command, adapter.healthcheck.args ?? [], {
      cwd: root,
      encoding: 'utf8',
      timeout: adapter.healthcheck.timeout_ms ?? 5000,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return result.error || result.status !== 0 ? 'unavailable' : 'available';
  } catch { return 'unavailable'; }
}

function validationScripts(): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const scripts = pkg.scripts ?? {};
    return ['typecheck', 'lint', 'test', 'build'].filter((name) => typeof scripts[name] === 'string');
  } catch { return []; }
}

function packageManager(): string {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function runValidationScript(manager: string, name: string): TaskValidationResult {
  const started = Date.now();
  const result = spawnSync(manager, ['run', name], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000
  });
  const output = [result.stdout, result.stderr]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .trim()
    .split(/\r?\n/)
    .slice(0, MAX_OUTPUT_LINES)
    .join('\n');
  return {
    name,
    passed: result.status === 0 && !result.error,
    durationMs: Date.now() - started,
    output
  };
}

export function runTaskValidation(checks: string[]): TaskValidationResult[] {
  const manager = packageManager();
  const results: TaskValidationResult[] = [];
  for (const name of checks) {
    const result = runValidationScript(manager, name);
    results.push(result);
    if (!result.passed) break;
  }
  return results;
}

function normalizeRepoPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (!trimmed || trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) return null;
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

export function parseWriteScope(value: string | null): { paths: string[]; error: string | null } {
  if (value === null) return { paths: [], error: null };
  const paths = [...new Set(value.split(',').map(normalizeRepoPath))];
  if (paths.some((entry) => entry === null)) return { paths: [], error: '--write-scope must contain only safe repo-relative paths separated by commas' };
  if (paths.length === 0) return { paths: [], error: '--write-scope requires at least one path' };
  const normalizedPaths = paths as string[];
  if (normalizedPaths.some((entry) => entry === '.ai' || entry.startsWith('.ai/') || entry === '.git' || entry.startsWith('.git/'))) {
    return { paths: [], error: '--write-scope cannot grant the .ai or .git directory' };
  }
  return { paths: normalizedPaths, error: null };
}

function pathMatchesScope(file: string, scope: string): boolean {
  return file === scope || file.startsWith(`${scope}/`);
}

export function findOutOfScopePaths(changedPaths: Iterable<string>, writeScope: string[], internalPaths: Set<string>): string[] {
  return [...new Set(changedPaths)]
    .filter((file) => !internalPaths.has(file) && !writeScope.some((scope) => pathMatchesScope(file, scope)))
    .sort();
}

function sha256File(absolutePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  } catch { return null; }
}

function collectFiles(directory: string, repositoryRoot: string, output: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, repositoryRoot, output);
    else if (entry.isFile()) output.push(path.relative(repositoryRoot, absolute).split(path.sep).join('/'));
  }
}

function gitChangedPaths(): { ok: boolean; paths: Set<string> } {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || result.error) return { ok: false, paths: new Set() };
  const paths = new Set<string>();
  const records = (result.stdout ?? '').split('\0').filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const file = record.slice(3);
    if (file) paths.add(file.split(' -> ').at(-1)!);
    // In porcelain -z rename/copy entries carry the old path as a second NUL
    // record. It is harmless to include it in the snapshot as well.
    if (record[0] === 'R' || record[1] === 'R' || record[0] === 'C' || record[1] === 'C') {
      const oldPath = records[index + 1];
      if (oldPath) paths.add(oldPath);
      index += 1;
    }
  }
  return { ok: true, paths };
}

export function captureTaskSafetySnapshot(dependencyGraph: DependencyGraph, additionalScopes: string[] = []): TaskSafetySnapshot | null {
  const git = gitChangedPaths();
  if (!git.ok) return null;
  const aiFiles = new Map<string, string>();
  const aiPaths: string[] = [];
  collectFiles(path.join(root, '.ai'), root, aiPaths);
  for (const file of aiPaths) {
    const hash = sha256File(path.join(root, file));
    if (hash) aiFiles.set(file, hash);
  }
  const sourceFiles = new Map<string, string>();
  for (const node of dependencyGraph.nodes) {
    const hash = sha256File(path.join(root, node.path));
    if (hash) sourceFiles.set(node.path, hash);
  }
  const scopedPaths: string[] = [];
  for (const scope of additionalScopes) collectFiles(path.join(root, scope), root, scopedPaths);
  for (const file of scopedPaths) {
    const hash = sha256File(path.join(root, file));
    if (hash) sourceFiles.set(file, hash);
  }
  return { gitPaths: git.paths, aiFiles, sourceFiles, scopes: [...additionalScopes] };
}

export function changedPathsSince(snapshot: TaskSafetySnapshot, dependencyGraph: DependencyGraph): string[] | null {
  const git = gitChangedPaths();
  if (!git.ok) return null;
  const changed = new Set([...git.paths].filter((file) => !snapshot.gitPaths.has(file)));

  const currentAi = new Map<string, string>();
  const aiPaths: string[] = [];
  collectFiles(path.join(root, '.ai'), root, aiPaths);
  for (const file of aiPaths) {
    const hash = sha256File(path.join(root, file));
    if (hash) currentAi.set(file, hash);
  }
  for (const file of new Set([...snapshot.aiFiles.keys(), ...currentAi.keys()])) {
    if (snapshot.aiFiles.get(file) !== currentAi.get(file)) changed.add(file);
  }

  const currentSources = new Map<string, string>();
  for (const node of dependencyGraph.nodes) {
    const hash = sha256File(path.join(root, node.path));
    if (hash) currentSources.set(node.path, hash);
  }
  const scopedPaths: string[] = [];
  for (const scope of snapshot.scopes) collectFiles(path.join(root, scope), root, scopedPaths);
  for (const file of scopedPaths) {
    const hash = sha256File(path.join(root, file));
    if (hash) currentSources.set(file, hash);
  }
  for (const file of new Set([...snapshot.sourceFiles.keys(), ...currentSources.keys()])) {
    if (snapshot.sourceFiles.get(file) !== currentSources.get(file)) changed.add(file);
  }
  return [...changed].sort();
}

function parseIntegerOption(name: string, fallback: number, minimum: number, maximum: number): number | null {
  const raw = getArgValue(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    process.stderr.write(`Error: ${name} must be between ${minimum} and ${maximum}.\n`);
    return null;
  }
  return value;
}

function generatedTaskId(objective: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'execution';
  const base = `TASK-${date}-${slug}`;
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(path.join(root, CONTEXT_DIR, `${candidate}.json`))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function readStandardRoute(): { provider: string | null; model: string | null } {
  try {
    const lines = fs.readFileSync(path.join(root, '.ai/model-routing.yaml'), 'utf8').split(/\r?\n/);
    let inTiers = false;
    let inStandard = false;
    let provider: string | null = null;
    let model: string | null = null;
    for (const line of lines) {
      if (line === 'tiers:') { inTiers = true; continue; }
      if (!inTiers) continue;
      if (/^[A-Za-z0-9_-]+:/.test(line)) break;
      if (/^  standard:\s*$/.test(line)) { inStandard = true; continue; }
      if (inStandard && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
      const match = line.match(/^    (provider|model):\s*(.+)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (match[1] === 'provider') provider = value;
      else model = value;
    }
    return { provider, model };
  } catch { return { provider: null, model: null }; }
}

function selectAdapter(adapters: string[]): { name: string | null; model: string | null } {
  const route = readStandardRoute();
  const explicit = getArgValue('--adapter');
  return {
    name: explicit ?? (route.provider && adapters.includes(route.provider) ? route.provider : adapters[0] ?? null),
    model: getArgValue('--model') ?? route.model
  };
}

async function confirmExecution(objective: string, adapter: string, writeScope: string[], bypass: boolean, quiet = false): Promise<boolean> {
  if (quiet && bypass) return true;
  process.stdout.write([
    'ForgeAI task execution — confirmation required',
    '',
    `  Objective   ${objective}`,
    `  Adapter     ${adapter}`,
    `  Write scope ${writeScope.length ? writeScope.join(', ') : '(none)'}`,
    '',
    '  The adapter may edit only the write scope above.',
    bypass ? '  Confirmation: accepted via --yes' : ''
  ].filter(Boolean).join('\n') + '\n');
  if (bypass) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('Error: task execution requires an interactive confirmation; rerun with --yes in a reviewed environment.\n');
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('  Proceed? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function writeArtifact(artifact: CompiledContextArtifact, taskId: string): { jsonPath: string; markdownPath: string } {
  const jsonPath = path.join(root, CONTEXT_DIR, `${taskId}.json`);
  const markdownPath = path.join(root, CONTEXT_DIR, `${taskId}.md`);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderCompiledContextMarkdown(artifact));
  return { jsonPath, markdownPath };
}

function relativePath(absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function printValidation(results: TaskValidationResult[], checks: string[]): void {
  if (checks.length === 0) {
    process.stdout.write(formatStatus('skipped', 'no typecheck/lint/test/build script detected') + '\n');
    return;
  }
  for (const result of results) {
    process.stdout.write(formatStatus(result.passed ? 'pass' : 'fail', `${result.name} (${result.durationMs}ms)`) + '\n');
    if (!result.passed && result.output) process.stdout.write(`${result.output}\n`);
  }
  if (results.length < checks.length) {
    process.stdout.write(formatStatus('skipped', `after ${results.at(-1)?.name} failed: ${checks.slice(results.length).join(', ')}`) + '\n');
  }
}

export async function runTask(): Promise<void> {
  const jsonMode = rawArgs.includes('--json');
  const objective = parseTaskObjective(rawArgs);
  if (validateArgFlag('--objective', rawArgs) !== null || !objective || objective.trim() === '') {
    process.stderr.write('Usage: forgeai-init task "<objective>" [--yes] [--adapter <name>] [--write-scope <path[,path...]>]\n       forgeai-init task --dry-run "<objective>"\n       forgeai-init task --dry-run --objective "<description>"\n');
    process.exitCode = 2;
    return;
  }

  let depGraph: DependencyGraph;
  try {
    depGraph = generateDependencyGraph(root);
  } catch (error) {
    process.stderr.write(`Error: could not analyze source files (${getErrorMessage(error)}).\n`);
    process.exitCode = 1;
    return;
  }

  const profile = detectProjectProfile();
  const components = profile && getAvailableProfiles().includes(profile) ? [profile] : [];
  const rules = resolveExclusions(components);
  const curated = tryReadCuratedCodeGraph(root) ?? normalizeCuratedGraph(null);
  const report = buildTryReport(objective, depGraph, curated, { maxNodes: DEFAULT_MAX_NODES, maxDepth: DEFAULT_MAX_DEPTH, rules, includeGlobs: [] });

  if (rawArgs.includes('--dry-run')) {
    const adapters = configuredAdapters();
    const checks = validationScripts();
    process.stdout.write([
      'ForgeAI task preview — no files changed',
      '',
      `  Objective   ${report.objective}`,
      `  Profile     ${profile ?? 'base (auto-detection unavailable)'}`,
      `  Context     ${report.selected.length} selected file${report.selected.length === 1 ? '' : 's'} / max 12, depth max 2`,
      `  Adapters    ${adapters.length ? adapters.map((name) => `${name} (${checkCliAdapter(name)})`).join(', ') : 'none configured (copy/paste assignment only)'}`,
      `  Checks      ${checks.length ? checks.join(', ') : 'none detected'}`,
      '',
      formatTryOutput(report, detectCtaState(root)),
      '  Proposed task flow:',
      '    1. Compile the bounded context artifact.',
      `    2. ${adapters.length ? `Route it through ${adapters[0]}.` : 'Run --add-model <provider> or configure .ai/cli-adapters.json, then route the artifact.'}`,
      `    3. Run ${checks.length ? checks.join(', ') : 'the repository validation command'} and inspect the diff.`,
      '',
      '  This is a preview: no .ai/ files, source files, or git state were changed.'
    ].join('\n'));
    return;
  }

  const customScope = parseWriteScope(getArgValue('--write-scope'));
  if (customScope.error) {
    process.stderr.write(`Error: ${customScope.error}.\n`);
    process.exitCode = 2;
    return;
  }
  // API adapters return text and cannot safely apply repository edits. Task
  // execution therefore requires a CLI adapter; API adapters remain visible
  // in the preview.
  const adapters = configuredCliAdapters();
  const selectedAdapter = selectAdapter(adapters);
  if (!selectedAdapter.name) {
    process.stderr.write('Error: task execution requires a CLI adapter. API-only adapters can be used with --route, but cannot apply repository changes. Configure .ai/cli-adapters.json first.\n');
    process.exitCode = 1;
    return;
  }
  if (!adapters.includes(selectedAdapter.name)) {
    process.stderr.write(`Error: adapter '${selectedAdapter.name}' is not configured.\n`);
    process.exitCode = 1;
    return;
  }

  const writeScope = customScope.paths.length > 0 ? customScope.paths : report.selected.map((selected: SelectedContextNode) => selected.node.path);
  if (writeScope.length === 0) {
    process.stderr.write('Error: no relevant files were selected. Refine the objective or provide --write-scope <path>.\n');
    process.exitCode = 1;
    return;
  }

  const taskIdArg = getArgValue('--task');
  if (taskIdArg !== null && !isValidTaskId(taskIdArg)) {
    process.stderr.write('Error: --task must be a valid task id (TASK-YYYYMMDD-slug).\n');
    process.exitCode = 2;
    return;
  }
  const taskId = taskIdArg ?? generatedTaskId(objective);
  const artifactPath = path.join(root, CONTEXT_DIR, `${taskId}.json`);
  const markdownPath = path.join(root, CONTEXT_DIR, `${taskId}.md`);
  const saveReport = (status: 'passed' | 'failed' | 'cancelled' | 'needs-human', changedFiles: string[], outOfScopeFiles: string[], validations: TaskValidationResult[], error: string | null, nextAction: string): void => {
    const taskReport = createTaskReport({ task_id: taskId, objective: report.objective, adapter: selectedAdapter.name, model: selectedAdapter.model, write_scope: writeScope, changed_files: changedFiles, out_of_scope_files: outOfScopeFiles, validations, status, error, next_action: nextAction });
    const paths = writeTaskReport(root, taskReport);
    if (jsonMode) process.stdout.write(`${JSON.stringify(taskReport, null, 2)}\n`);
    else process.stdout.write(`${formatStatus('ok', `task report written to ${relativePath(paths.markdownPath)}`)}\n`);
  };

  let artifact: CompiledContextArtifact;
  try {
    const budget = parseIntegerOption('--budget', DEFAULT_BUDGET, 256, 200_000);
    const maxDepth = parseIntegerOption('--max-depth', DEFAULT_MAX_DEPTH, 0, 5);
    const maxNodes = parseIntegerOption('--max-nodes', DEFAULT_MAX_NODES, 1, 50);
    if (budget === null || maxDepth === null || maxNodes === null) { process.exitCode = 2; return; }
    artifact = compileContext(objective, curated, depGraph, root, { budget, maxDepth, maxNodes, taskId, rules, includeGlobs: [], profiles: components });
  } catch (error) {
    process.stderr.write(`Error: context compilation failed (${getErrorMessage(error)}).\n`);
    process.exitCode = 1;
    return;
  }

  if (!(await confirmExecution(report.objective, selectedAdapter.name, writeScope, rawArgs.includes('--yes'), jsonMode))) {
    if (!jsonMode) process.stdout.write('Task cancelled; no files changed.\n');
    saveReport('cancelled', [], [], [], null, 'Review the scope and rerun with --yes or interactive confirmation.');
    return;
  }

  const snapshot = captureTaskSafetySnapshot(depGraph, writeScope);
  if (!snapshot) {
    process.stderr.write('Error: task execution requires a git worktree so ForgeAI can enforce write scope.\n');
    process.exitCode = 1;
    return;
  }
  writeArtifact(artifact, taskId);
  if (!jsonMode) {
    process.stdout.write(`${formatStatus('ok', `compiled context written to ${relativePath(artifactPath)}`)}\n`);
    process.stdout.write(`${formatStatus('ok', `inspection Markdown written to ${relativePath(markdownPath)}`)}\n`);
  }

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  await routeToAdapter(artifact, artifactPath, selectedAdapter.name, selectedAdapter.model, root, false, jsonMode);
  const adapterFailed = process.exitCode !== undefined && process.exitCode !== 0;
  process.exitCode = previousExitCode;

  const changedPaths = changedPathsSince(snapshot, depGraph);
  if (changedPaths === null) {
    process.stderr.write('Error: could not inspect git state after adapter execution; treating task as unsafe.\n');
    process.exitCode = 1;
    return;
  }
  const internalPaths = new Set([relativePath(artifactPath), relativePath(markdownPath), ROUTE_JOURNAL]);
  const changed = changedPaths.filter((file) => !internalPaths.has(file));
  const outOfScope = findOutOfScopePaths(changedPaths, writeScope, internalPaths);
  if (outOfScope.length > 0) {
    process.stderr.write(`Error: adapter changed files outside write scope: ${outOfScope.join(', ')}.\n`);
    process.stderr.write('The changes were left intact for review; ForgeAI will not revert user work automatically.\n');
    process.exitCode = 1;
    saveReport('failed', changed, outOfScope, [], 'adapter changed files outside write scope', 'Inspect the listed files and decide whether to keep or revert them manually.');
    return;
  }
  if (adapterFailed) {
    process.stderr.write('Error: adapter execution failed; validation was skipped.\n');
    process.exitCode = 1;
    saveReport('failed', changed, [], [], 'adapter execution failed', 'Inspect the adapter error and rerun after fixing its configuration.');
    return;
  }

  if (changed.length === 0) {
    process.stderr.write('Error: adapter completed without changing any repository file; task is not verified.\n');
    process.exitCode = 1;
    saveReport('failed', changed, [], [], 'adapter completed without changing any repository file', 'Refine the objective or adapter instructions and rerun.');
    return;
  }

  const checks = validationScripts();
  const validations = runTaskValidation(checks);
  if (!jsonMode) { process.stdout.write('\nValidation\n'); printValidation(validations, checks); }
  const validationFailed = validations.some((result) => !result.passed);
  if (!jsonMode) {
    process.stdout.write('\n');
    process.stdout.write(validationFailed ? 'Result: task changed only the allowed scope, but validation failed.\n' : 'Result: task execution completed within scope and validation passed.\n');
  }
  saveReport(validationFailed ? 'failed' : 'passed', changed, [], validations, validationFailed ? 'validation failed' : null, validationFailed ? 'Fix the failing validation and rerun the task.' : 'Review the diff and commit when ready.');
  if (validationFailed) process.exitCode = 1;
}
