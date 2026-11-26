import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { root, rawArgs, getArgValue, validateArgFlag } from './context.js';
import { isProtectedHarnessPath } from './code-mode.js';
import { loadOrGenerateDependencyGraph } from './dependency-graph.js';
import { getErrorMessage, formatStatus, isValidTaskId } from './utils.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { resolveExclusions } from './profile-exclusions.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph, type SelectedContextNode } from './context-pack.js';
import { formatTryOutput, buildTryReport, parseTryObjective, detectCtaState, type TryReport } from './try.js';
import { compileContext, renderAgentAssignment, renderCompiledContextMarkdown } from './context-compiler.js';
import { routeToAdapter } from './router.js';
import { createTaskReport, writeTaskReport } from './task-report.js';
import { analyzeFilesQuality } from './code-quality.js';
import { acquireSessionLock, LOCKS_RELATIVE_DIR, registerCrashSafeLockRelease } from './sessions.js';
import type {
  Adapter,
  AdapterConfig,
  AgentResponse,
  CompiledContextArtifact,
  DependencyGraph,
  ResolvedExclusionRule
} from './types.js';

const CONTEXT_DIR = '.ai/state/context';
const ROUTE_JOURNAL = '.ai/state/context-routes.md';
const DEFAULT_BUDGET = 6000;
const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_DEPTH = 2;
const MAX_OUTPUT_LINES = 20;
const TASK_VALUE_FLAGS = new Set([
  '--adapter', '--model', '--task', '--budget', '--max-depth', '--max-nodes', '--write-scope', '--tier'
]);
const TASK_BOOLEAN_FLAGS = new Set(['--dry-run', '--yes', '--code-mode']);

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

  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (TASK_BOOLEAN_FLAGS.has(value)) continue;
    if (TASK_VALUE_FLAGS.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith('--')) return value;
  }
  return null;
}

function extractAdapterKeysFromFile(file: string): string[] {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const entries = (typeof value === 'object' && value !== null ? (value as { adapters?: unknown }).adapters : null);
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      return Object.keys(entries);
    }
  } catch { /* not initialized or malformed */ }
  return [];
}

function adapterNames(files: string[]): string[] {
  return [...new Set(files.flatMap(extractAdapterKeysFromFile))].sort();
}

function configuredAdapters(): string[] {
  return adapterNames(['.ai/cli-adapters.json', '.ai/api-adapters.json']);
}

function configuredCliAdapters(): string[] {
  return adapterNames(['.ai/cli-adapters.json']);
}

function configuredCodeModeApiAdapters(forceCodeMode: boolean): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.ai/api-adapters.json'), 'utf8')) as {
      adapters?: Record<string, { code_mode?: boolean }>;
    };
    const entries = raw?.adapters;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return [];
    return Object.entries(entries)
      .filter(([, cfg]) => forceCodeMode || Boolean(cfg?.code_mode))
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
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
  } catch {
    return 'unavailable';
  }
}

function validationScripts(): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    return ['typecheck', 'lint', 'test', 'build'].filter((name) => typeof scripts[name] === 'string');
  } catch {
    return [];
  }
}

const LOCKFILE_MANAGERS: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun']
];

function resolveTaskPackageManager(): string {
  const match = LOCKFILE_MANAGERS.find(([lock]) => fs.existsSync(path.join(root, lock)));
  return match ? match[1] : 'npm';
}

function trimCommandOutput(stdout: string | null | undefined, stderr: string | null | undefined): string {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
  return combined.split(/\r?\n/).slice(0, MAX_OUTPUT_LINES).join('\n');
}

export function runTaskValidation(checks: string[]): TaskValidationResult[] {
  const manager = resolveTaskPackageManager();
  const results: TaskValidationResult[] = [];
  for (const name of checks) {
    const started = Date.now();
    const proc = spawnSync(manager, ['run', name], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000
    });
    const passed = proc.status === 0 && !proc.error;
    results.push({ name, passed, durationMs: Date.now() - started, output: trimCommandOutput(proc.stdout, proc.stderr) });
    if (!passed) break;
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
  if (paths.some((entry) => entry === null)) {
    return { paths: [], error: '--write-scope must contain only safe repo-relative paths separated by commas' };
  }
  if (paths.length === 0) return { paths: [], error: '--write-scope requires at least one path' };
  const normalizedPaths = paths as string[];
  if (normalizedPaths.some(isProtectedHarnessPath)) {
    return { paths: [], error: '--write-scope cannot grant the .ai or .git directory' };
  }
  return { paths: normalizedPaths, error: null };
}

function pathMatchesScope(file: string, scope: string): boolean {
  return file === scope || file.startsWith(`${scope}/`);
}

function isSessionLockStatePath(file: string): boolean {
  return file === LOCKS_RELATIVE_DIR || file.startsWith(`${LOCKS_RELATIVE_DIR}/`);
}

export function findOutOfScopePaths(
  changedPaths: Iterable<string>,
  writeScope: string[],
  internalPaths: Set<string>
): string[] {
  return [...new Set(changedPaths)]
    .filter(
      (file) =>
        !internalPaths.has(file)
        && !isSessionLockStatePath(file)
        && !writeScope.some((scope) => pathMatchesScope(file, scope))
    )
    .sort();
}

function sha256File(absolutePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  } catch {
    return null;
  }
}

function collectFiles(directory: string, repositoryRoot: string, output: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, repositoryRoot, output);
    else if (entry.isFile()) output.push(path.relative(repositoryRoot, absolute).split(path.sep).join('/'));
  }
}

function isRenameOrCopyRecord(record: string): boolean {
  return record.startsWith('R') || record[1] === 'R' || record.startsWith('C') || record[1] === 'C';
}

function consumePorcelainRecord(records: string[], index: number, paths: Set<string>): number {
  const record = records[index];
  const file = record.slice(3).split(' -> ').at(-1);
  if (file) paths.add(file);
  if (isRenameOrCopyRecord(record)) {
    const oldPath = records[index + 1];
    if (oldPath) paths.add(oldPath);
    return index + 1;
  }
  return index;
}

function gitChangedPaths(): { ok: boolean; paths: Set<string> } {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || result.error) return { ok: false, paths: new Set() };
  const paths = new Set<string>();
  const records = (result.stdout ?? '').split('\0').filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    index = consumePorcelainRecord(records, index, paths);
  }
  return { ok: true, paths };
}

function hashFileList(files: string[], skipLocks: boolean): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of files) {
    if (skipLocks && isSessionLockStatePath(file)) continue;
    const hash = sha256File(path.join(root, file));
    if (hash) hashes.set(file, hash);
  }
  return hashes;
}

function buildSourceHashSnapshot(dependencyGraph: DependencyGraph, scopes: string[]): Map<string, string> {
  const scopedPaths: string[] = [];
  for (const scope of scopes) collectFiles(path.join(root, scope), root, scopedPaths);
  const allFiles = [...dependencyGraph.nodes.map((n) => n.path), ...scopedPaths];
  return hashFileList(allFiles, false);
}

function buildAiHashSnapshot(): Map<string, string> {
  const aiPaths: string[] = [];
  collectFiles(path.join(root, '.ai'), root, aiPaths);
  return hashFileList(aiPaths, true);
}

export function captureTaskSafetySnapshot(
  dependencyGraph: DependencyGraph,
  additionalScopes: string[] = []
): TaskSafetySnapshot | null {
  const git = gitChangedPaths();
  if (!git.ok) return null;
  return {
    gitPaths: git.paths,
    aiFiles: buildAiHashSnapshot(),
    sourceFiles: buildSourceHashSnapshot(dependencyGraph, additionalScopes),
    scopes: [...additionalScopes]
  };
}

function addChangedKeys(before: Map<string, string>, after: Map<string, string>, out: Set<string>): void {
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(file) !== after.get(file)) out.add(file);
  }
}

export function changedPathsSince(
  snapshot: TaskSafetySnapshot,
  dependencyGraph: DependencyGraph
): string[] | null {
  const git = gitChangedPaths();
  if (!git.ok) return null;
  const changed = new Set(
    [...git.paths].filter((file) => !snapshot.gitPaths.has(file) && !isSessionLockStatePath(file))
  );
  addChangedKeys(snapshot.aiFiles, buildAiHashSnapshot(), changed);
  addChangedKeys(snapshot.sourceFiles, buildSourceHashSnapshot(dependencyGraph, snapshot.scopes), changed);
  return [...changed].sort();
}

function readBoundedFlagValue(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const raw = getArgValue(name);
  if (raw === null) return fallback;
  const num = Number(raw);
  const valid = Number.isInteger(num) && num >= minimum && num <= maximum;
  if (!valid) {
    process.stderr.write(`Error: ${name} must be between ${minimum} and ${maximum}.\n`);
    return null;
  }
  return num;
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

function extractStandardSectionLines(lines: string[]): string[] {
  const tiersIdx = lines.indexOf('tiers:');
  if (tiersIdx === -1) return [];
  const out: string[] = [];
  let inStandard = false;
  for (const line of lines.slice(tiersIdx + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
    if (/^  standard:\s*$/.test(line)) { inStandard = true; continue; }
    if (inStandard && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
    if (inStandard) out.push(line);
  }
  return out;
}

function readStandardRoute(): { provider: string | null; model: string | null } {
  try {
    const lines = fs.readFileSync(path.join(root, '.ai/model-routing.yaml'), 'utf8').split(/\r?\n/);
    let provider: string | null = null;
    let model: string | null = null;
    for (const line of extractStandardSectionLines(lines)) {
      const match = line.match(/^    (provider|model):\s*(.+)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (match[1] === 'provider') provider = value;
      else model = value;
    }
    return { provider, model };
  } catch {
    return { provider: null, model: null };
  }
}

function selectAdapter(adapters: string[]): { name: string | null; model: string | null } {
  const route = readStandardRoute();
  const explicit = getArgValue('--adapter');
  const preferred = route.provider && adapters.includes(route.provider) ? route.provider : (adapters[0] ?? null);
  return {
    name: explicit ?? preferred,
    model: getArgValue('--model') ?? route.model
  };
}

async function confirmExecution(
  objective: string,
  adapter: string,
  writeScope: string[],
  bypass: boolean,
  quiet = false
): Promise<boolean> {
  if (quiet && bypass) return true;
  const scopeText = writeScope.length ? writeScope.join(', ') : '(none)';
  process.stdout.write(
    [
      'ForgeAI task execution — confirmation required',
      '',
      `  Objective   ${objective}`,
      `  Adapter     ${adapter}`,
      `  Write scope ${scopeText}`,
      '',
      '  The adapter may edit only the write scope above.',
      bypass ? '  Confirmation: accepted via --yes' : ''
    ]
      .filter(Boolean)
      .join('\n') + '\n'
  );
  if (bypass) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      'Error: task execution requires an interactive confirmation; rerun with --yes in a reviewed environment.\n'
    );
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

function persistTaskContextFiles(artifact: CompiledContextArtifact, jsonPath: string, markdownPath: string): void {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderCompiledContextMarkdown(artifact));
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
    const last = results.at(-1)?.name;
    const remaining = checks.slice(results.length).join(', ');
    process.stdout.write(formatStatus('skipped', `after ${last} failed: ${remaining}`) + '\n');
  }
}

function renderDryRunPreview(
  report: TryReport,
  profile: string | null,
  maxNodes: number,
  maxDepth: number,
  budget: number,
  skipChecks: boolean
): void {
  const adapters = configuredAdapters();
  const checks = validationScripts();
  const plural = report.selected.length === 1 ? '' : 's';
  const adapterLine = adapters.length
    ? adapters.map((name) => `${name} (${checkCliAdapter(name)})`).join(', ')
    : 'none configured (copy/paste assignment only)';
  const routeStep = adapters.length
    ? `Route it through ${adapters[0]}.`
    : 'Hand the assignment to your current coding agent; no adapter setup required.';
  const checkStep = skipChecks
    ? 'Validation is disabled by --no-check; inspect the diff and run checks manually.'
    : `Run ${checks.length ? checks.join(', ') : 'the repository validation command'} and inspect the diff.`;
  process.stdout.write(
    [
      'ForgeAI task preview — no files changed',
      '',
      `  Objective   ${report.objective}`,
      `  Profile     ${profile ?? 'base (auto-detection unavailable)'}`,
      `  Context     ${report.selected.length} selected file${plural} / max ${maxNodes}, depth max ${maxDepth}, budget ${budget} tokens`,
      `  Adapters    ${adapterLine}`,
      `  Checks      ${checks.length ? checks.join(', ') : 'none detected'}`,
      '',
      formatTryOutput(report, detectCtaState(root)),
      '  Proposed task flow:',
      '    1. Compile the bounded context artifact.',
      `    2. ${routeStep}`,
      `    3. ${checkStep}`,
      '',
      '  This is a preview: no .ai/ files, source files, or git state were changed.'
    ].join('\n')
  );
}

type SaveReportFn = (
  status: 'passed' | 'failed' | 'cancelled' | 'needs-human',
  changedFiles: string[],
  outOfScopeFiles: string[],
  validations: TaskValidationResult[],
  error: string | null,
  nextAction: string,
  agentResponse?: AgentResponse | null
) => void;

function handleUnconfiguredAdapterHandoff(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  markdownPath: string,
  writeScope: string[],
  jsonMode: boolean,
  saveReport: SaveReportFn
): void {
  persistTaskContextFiles(artifact, artifactPath, markdownPath);
  if (!jsonMode) {
    process.stdout.write(
      [
        'ForgeAI task handoff — no external CLI adapter configured',
        '',
        `  Context artifact: ${relativePath(artifactPath)}`,
        `  Assignment:       ${relativePath(markdownPath)}`,
        `  Write scope:      ${writeScope.length ? writeScope.join(', ') : '(none)'}`,
        '',
        'The current coding agent can continue this task using the bounded',
        'assignment above. ForgeAI will not spawn another model or modify',
        'router configuration automatically.',
        '',
        renderAgentAssignment(artifact),
        '',
        'Next action: implement the change inside the write scope, run checks,',
        'and review the diff. Configure .ai/cli-adapters.json only if you want',
        'ForgeAI to invoke a separate CLI model automatically.',
        ''
      ].join('\n')
    );
  }
  saveReport(
    'needs-human',
    [],
    [],
    [],
    'no CLI adapter configured; execution handed off to the current agent',
    `Review ${relativePath(markdownPath)}, apply only the listed write scope, then run the repository checks.`
  );
}

async function runLockedAdapterExecution(
  taskId: string,
  adapterName: string,
  adapterModel: string | null,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  markdownPath: string,
  writeScope: string[],
  useCodeMode: boolean,
  jsonMode: boolean
): Promise<{ agentResponse: AgentResponse | null | undefined; adapterFailed: boolean }> {
  const releaseSession = registerCrashSafeLockRelease(taskId, adapterName, root);
  try {
    persistTaskContextFiles(artifact, artifactPath, markdownPath);
    if (!jsonMode) {
      process.stdout.write(`${formatStatus('ok', `compiled context written to ${relativePath(artifactPath)}`)}\n`);
      process.stdout.write(`${formatStatus('ok', `inspection Markdown written to ${relativePath(markdownPath)}`)}\n`);
    }
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const agentResponse = await routeToAdapter(
      artifact,
      artifactPath,
      adapterName,
      adapterModel,
      root,
      false,
      jsonMode,
      {
        codeMode: useCodeMode,
        writeScope,
        readScope: artifact.selection.files.map((f) => f.path)
      }
    );
    const adapterFailed = process.exitCode !== undefined && process.exitCode !== 0;
    process.exitCode = previousExitCode;
    return { agentResponse, adapterFailed };
  } finally {
    releaseSession();
  }
}

function checkCodeQualityForTask(changed: string[]): TaskValidationResult | null {
  const qualityStarted = Date.now();
  const quality = analyzeFilesQuality(root, changed);
  if (quality.passed) return null;
  const issues = [
    ...quality.complex_functions.map((fn) => {
      const crap = fn.crap_score !== null ? `, CRAP ${fn.crap_score}` : '';
      return `${fn.path}:${fn.start_line} "${fn.name}" complexity ${fn.complexity}${crap} >= 10`;
    }),
    ...quality.duplicates.map(
      (dup) =>
        `${dup.first.path}:${dup.first.start_line} "${dup.first.name}" and ${dup.second.path}:${dup.second.start_line} "${dup.second.name}" similarity ${dup.similarity} >= 0.8`
    )
  ];
  return {
    name: 'code-quality',
    passed: false,
    durationMs: Date.now() - qualityStarted,
    output: issues.slice(0, MAX_OUTPUT_LINES).join('\n')
  };
}

function declaredFilesMatchActual(actualSorted: string[], declaredRaw: string[]): boolean {
  const declared = [...declaredRaw].sort();
  return actualSorted.length === declared.length && actualSorted.every((file, idx) => file === declared[idx]);
}

function resolveFinalTaskOutcome(validationFailed: boolean, skipChecks: boolean): {
  status: 'failed' | 'needs-human' | 'passed';
  err: string | null;
  next: string;
  summaryMsg: string;
} {
  if (validationFailed) {
    return {
      status: 'failed',
      err: 'validation failed',
      next: 'Fix the failing validation and rerun the task.',
      summaryMsg: 'Result: task changed only the allowed scope, but validation failed.\n'
    };
  }
  if (skipChecks) {
    return {
      status: 'needs-human',
      err: 'validation skipped by --no-check',
      next: 'Run the repository validation commands and review the diff.',
      summaryMsg: 'Result: task changed only the allowed scope; validation remains unverified.\n'
    };
  }
  return {
    status: 'passed',
    err: null,
    next: 'Review the diff and commit when ready.',
    summaryMsg: 'Result: task execution completed within scope and validation passed.\n'
  };
}

function finalizeTaskValidations(
  changed: string[],
  skipChecks: boolean,
  jsonMode: boolean,
  agentResponse: AgentResponse | null | undefined,
  saveReport: SaveReportFn
): void {
  const checks = skipChecks ? [] : validationScripts();
  const validations = skipChecks ? [] : runTaskValidation(checks);
  if (!skipChecks) {
    const qualityFailure = checkCodeQualityForTask(changed);
    if (qualityFailure) validations.push(qualityFailure);
  }
  const validationFailed = validations.some((result) => !result.passed);
  const outcome = resolveFinalTaskOutcome(validationFailed, skipChecks);
  if (!jsonMode) {
    process.stdout.write('\nValidation\n');
    if (skipChecks) process.stdout.write(formatStatus('skipped', 'disabled by --no-check; run checks manually') + '\n');
    else printValidation(validations, checks);
    process.stdout.write(`\n${outcome.summaryMsg}`);
  }
  saveReport(outcome.status, changed, [], validations, outcome.err, outcome.next, agentResponse ?? null);
  if (validationFailed) process.exitCode = 1;
}

function verifyChangedFilesAndExitStatus(
  changed: string[],
  agentResponse: AgentResponse | null | undefined,
  adapterFailed: boolean,
  saveReport: SaveReportFn
): boolean {
  if (agentResponse && !declaredFilesMatchActual([...changed].sort(), agentResponse.changed_files)) {
    const declared = [...agentResponse.changed_files].sort().join(', ') || 'none';
    const actual = [...changed].sort().join(', ') || 'none';
    process.stderr.write(`Error: adapter response changed_files does not match git changes. Declared: ${declared}; actual: ${actual}.\n`);
    process.exitCode = 1;
    saveReport('failed', changed, [], [], 'adapter response changed_files does not match git changes', 'Inspect the adapter output and git diff, then rerun with a truthful response.', agentResponse);
    return false;
  }
  if (adapterFailed) {
    process.stderr.write('Error: adapter execution failed; validation was skipped.\n');
    process.exitCode = 1;
    saveReport('failed', changed, [], [], 'adapter execution failed', 'Inspect the adapter error and rerun after fixing its configuration.', agentResponse ?? null);
    return false;
  }
  if (changed.length === 0) {
    process.stderr.write('Error: adapter completed without changing any repository file; task is not verified.\n');
    process.exitCode = 1;
    saveReport('failed', changed, [], [], 'adapter completed without changing any repository file', 'Refine the objective or adapter instructions and rerun.', agentResponse ?? null);
    return false;
  }
  return true;
}

function verifyPostExecutionState(
  snapshot: TaskSafetySnapshot,
  depGraph: DependencyGraph,
  artifactPath: string,
  markdownPath: string,
  writeScope: string[],
  agentResponse: AgentResponse | null | undefined,
  adapterFailed: boolean,
  saveReport: SaveReportFn
): string[] | null {
  const changedPaths = changedPathsSince(snapshot, depGraph);
  if (changedPaths === null) {
    process.stderr.write('Error: could not inspect git state after adapter execution; treating task as unsafe.\n');
    process.exitCode = 1;
    return null;
  }
  const internalPaths = new Set([relativePath(artifactPath), relativePath(markdownPath), ROUTE_JOURNAL, '.forgeai.pipe']);
  const changed = changedPaths.filter((file) => !internalPaths.has(file));
  const outOfScope = findOutOfScopePaths(changedPaths, writeScope, internalPaths);
  if (outOfScope.length > 0) {
    process.stderr.write(`Error: adapter changed files outside write scope: ${outOfScope.join(', ')}.\n`);
    process.stderr.write('The changes were left intact for review; ForgeAI will not revert user work automatically.\n');
    process.exitCode = 1;
    saveReport('failed', changed, outOfScope, [], 'adapter changed files outside write scope', 'Inspect the listed files and decide whether to keep or revert them manually.');
    return null;
  }
  return verifyChangedFilesAndExitStatus(changed, agentResponse, adapterFailed, saveReport) ? changed : null;
}

type PreparedTaskInputs = {
  objective: string;
  budget: number;
  maxDepth: number;
  maxNodes: number;
  depGraph: DependencyGraph;
  profile: string | null;
  components: string[];
  rules: ResolvedExclusionRule[];
  curated: ReturnType<typeof normalizeCuratedGraph>;
  report: TryReport;
};

function readTaskNumericBounds(): { budget: number; maxDepth: number; maxNodes: number } | null {
  const budget = readBoundedFlagValue('--budget', DEFAULT_BUDGET, 256, 200_000);
  const maxDepth = readBoundedFlagValue('--max-depth', DEFAULT_MAX_DEPTH, 0, 5);
  const maxNodes = readBoundedFlagValue('--max-nodes', DEFAULT_MAX_NODES, 1, 50);
  if (budget === null || maxDepth === null || maxNodes === null) {
    process.exitCode = 2;
    return null;
  }
  return { budget, maxDepth, maxNodes };
}

function prepareTaskInputs(): PreparedTaskInputs | null {
  const objective = parseTaskObjective(rawArgs);
  if (validateArgFlag('--objective', rawArgs) !== null || !objective || objective.trim() === '') {
    process.stderr.write('Usage: forgeai-init task "<objective>" [--yes] [--no-check] [--adapter <name>] [--write-scope <path[,path...]>]\n       forgeai-init task --dry-run "<objective>" [--budget <tokens>] [--max-depth <0-5>] [--max-nodes <1-50>]\n       forgeai-init task --dry-run --objective "<description>"\n');
    process.exitCode = 2;
    return null;
  }
  const bounds = readTaskNumericBounds();
  if (!bounds) return null;
  let depGraph: DependencyGraph;
  try {
    depGraph = loadOrGenerateDependencyGraph(root);
  } catch (error) {
    process.stderr.write(`Error: could not analyze source files (${getErrorMessage(error)}).\n`);
    process.exitCode = 1;
    return null;
  }
  const profile = detectProjectProfile();
  const components = profile && getAvailableProfiles().includes(profile) ? [profile] : [];
  const rules = resolveExclusions(components);
  const curated = tryReadCuratedCodeGraph(root) ?? normalizeCuratedGraph(null);
  const report = buildTryReport(objective, depGraph, curated, {
    maxNodes: bounds.maxNodes,
    maxDepth: bounds.maxDepth,
    rules,
    includeGlobs: []
  });
  return { objective, ...bounds, depGraph, profile, components, rules, curated, report };
}

function resolveTaskScopeAndAdapter(
  report: TryReport,
  useCodeMode: boolean
): { writeScope: string[]; selectedAdapter: { name: string | null; model: string | null }; taskId: string } | null {
  const customScope = parseWriteScope(getArgValue('--write-scope'));
  if (customScope.error) {
    process.stderr.write(`Error: ${customScope.error}.\n`);
    process.exitCode = 2;
    return null;
  }
  const adapters = [...new Set([...configuredCliAdapters(), ...configuredCodeModeApiAdapters(useCodeMode)])].sort();
  const selectedAdapter = selectAdapter(adapters);
  const explicitAdapter = getArgValue('--adapter');
  if (explicitAdapter !== null && !adapters.includes(explicitAdapter)) {
    process.stderr.write(`Error: adapter '${explicitAdapter}' is not configured.\n`);
    process.exitCode = 1;
    return null;
  }
  const writeScope = customScope.paths.length > 0
    ? customScope.paths
    : report.selected.map((selected: SelectedContextNode) => selected.node.path);
  if (writeScope.length === 0) {
    process.stderr.write('Error: no relevant files were selected. Refine the objective or provide --write-scope <path>.\n');
    process.exitCode = 1;
    return null;
  }
  const taskIdArg = getArgValue('--task');
  if (taskIdArg !== null && !isValidTaskId(taskIdArg)) {
    process.stderr.write('Error: --task must be a valid task id (TASK-YYYYMMDD-slug).\n');
    process.exitCode = 2;
    return null;
  }
  return { writeScope, selectedAdapter, taskId: taskIdArg ?? generatedTaskId(report.objective) };
}

function makeTaskReportSaver(
  taskId: string,
  objective: string,
  selectedAdapter: { name: string | null; model: string | null },
  writeScope: string[],
  jsonMode: boolean
): SaveReportFn {
  return (status, changedFiles, outOfScopeFiles, validations, error, nextAction, agentResponse = null) => {
    const taskReport = createTaskReport({
      task_id: taskId,
      objective,
      adapter: selectedAdapter.name,
      model: selectedAdapter.model,
      write_scope: writeScope,
      changed_files: changedFiles,
      out_of_scope_files: outOfScopeFiles,
      validations,
      status,
      error,
      next_action: nextAction,
      agent_response: agentResponse
    });
    const paths = writeTaskReport(root, taskReport);
    if (jsonMode) process.stdout.write(`${JSON.stringify(taskReport, null, 2)}\n`);
    else process.stdout.write(`${formatStatus('ok', `task report written to ${relativePath(paths.markdownPath)}`)}\n`);
  };
}

function compileTaskArtifactOrFail(prepared: PreparedTaskInputs, taskId: string): CompiledContextArtifact | null {
  try {
    return compileContext(prepared.objective, prepared.curated, prepared.depGraph, root, {
      budget: prepared.budget,
      maxDepth: prepared.maxDepth,
      maxNodes: prepared.maxNodes,
      taskId,
      rules: prepared.rules,
      includeGlobs: [],
      profiles: prepared.components
    });
  } catch (error) {
    process.stderr.write(`Error: context compilation failed (${getErrorMessage(error)}).\n`);
    process.exitCode = 1;
    return null;
  }
}

function tryAcquireTaskSessionLock(
  taskId: string,
  owner: string,
  objective: string,
  writeScope: string[],
  artifact: CompiledContextArtifact,
  saveReport: SaveReportFn
): boolean {
  const lockAcquisition = acquireSessionLock(
    {
      sessionId: taskId,
      owner,
      taskId,
      objective,
      writeScope,
      readScope: artifact.selection.files.map((f) => f.path),
      pid: process.pid
    },
    root
  );
  if (lockAcquisition.ok) return true;
  process.stderr.write(`Error: write scope lock conflict — ${lockAcquisition.detail}\n`);
  process.exitCode = 1;
  saveReport(
    'failed',
    [],
    [],
    [],
    `write scope lock conflict: ${lockAcquisition.detail}`,
    'Wait for the conflicting session to finish, or run forgeai-init --check-sessions --recover-stale if the lock is stale.'
  );
  return false;
}

async function executeAdapterTaskBody(
  prepared: PreparedTaskInputs,
  taskId: string,
  adapterName: string,
  adapterModel: string | null,
  writeScope: string[],
  artifact: CompiledContextArtifact,
  artifactPath: string,
  markdownPath: string,
  useCodeMode: boolean,
  skipChecks: boolean,
  jsonMode: boolean,
  saveReport: SaveReportFn
): Promise<void> {
  if (!(await confirmExecution(prepared.report.objective, adapterName, writeScope, rawArgs.includes('--yes'), jsonMode))) {
    if (!jsonMode) process.stdout.write('Task cancelled; no files changed.\n');
    saveReport('cancelled', [], [], [], null, 'Review the scope and rerun with --yes or interactive confirmation.');
    return;
  }
  const snapshot = captureTaskSafetySnapshot(prepared.depGraph, writeScope);
  if (!snapshot) {
    process.stderr.write('Error: task execution requires a git worktree so ForgeAI can enforce write scope.\n');
    process.exitCode = 1;
    return;
  }
  if (!tryAcquireTaskSessionLock(taskId, adapterName, prepared.report.objective, writeScope, artifact, saveReport)) {
    return;
  }
  const { agentResponse, adapterFailed } = await runLockedAdapterExecution(
    taskId,
    adapterName,
    adapterModel,
    artifact,
    artifactPath,
    markdownPath,
    writeScope,
    useCodeMode,
    jsonMode
  );
  const changed = verifyPostExecutionState(
    snapshot,
    prepared.depGraph,
    artifactPath,
    markdownPath,
    writeScope,
    agentResponse,
    adapterFailed,
    saveReport
  );
  if (changed) finalizeTaskValidations(changed, skipChecks, jsonMode, agentResponse, saveReport);
}

export async function runTask(): Promise<void> {
  const jsonMode = rawArgs.includes('--json');
  const skipChecks = rawArgs.includes('--no-check');
  const prepared = prepareTaskInputs();
  if (!prepared) return;

  if (rawArgs.includes('--dry-run')) {
    renderDryRunPreview(prepared.report, prepared.profile, prepared.maxNodes, prepared.maxDepth, prepared.budget, skipChecks);
    return;
  }

  const useCodeMode = rawArgs.includes('--code-mode');
  const resolved = resolveTaskScopeAndAdapter(prepared.report, useCodeMode);
  if (!resolved) return;

  const { writeScope, selectedAdapter, taskId } = resolved;
  const artifactPath = path.join(root, CONTEXT_DIR, `${taskId}.json`);
  const markdownPath = path.join(root, CONTEXT_DIR, `${taskId}.md`);
  const saveReport = makeTaskReportSaver(taskId, prepared.report.objective, selectedAdapter, writeScope, jsonMode);

  const artifact = compileTaskArtifactOrFail(prepared, taskId);
  if (!artifact) return;

  if (!selectedAdapter.name) {
    handleUnconfiguredAdapterHandoff(artifact, artifactPath, markdownPath, writeScope, jsonMode, saveReport);
    return;
  }

  await executeAdapterTaskBody(
    prepared,
    taskId,
    selectedAdapter.name,
    selectedAdapter.model,
    writeScope,
    artifact,
    artifactPath,
    markdownPath,
    useCodeMode,
    skipChecks,
    jsonMode,
    saveReport
  );
}
