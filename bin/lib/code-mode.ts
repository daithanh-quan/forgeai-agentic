import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { root } from './context.js';
import { analyzeFilesQuality, discoverTargetQualityFiles, stripCommentsAndStrings } from './code-quality.js';
import { compileContextForObjective } from './context-command.js';
import { compileContextExpansion } from './context-compiler.js';
import { artifactDigest, recordEscapes, recordObservation } from './context-escapes.js';
import { validateNeedContext } from './context-expansion.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph } from './context-pack.js';
import { loadOrGenerateDependencyGraph } from './dependency-graph.js';
import { buildDiffSummary, buildStatusSummary } from './diagnostics.js';
import { parserForFile } from './language-registry.js';
import { resolveExclusions } from './profile-exclusions.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { buildTryReport } from './try.js';
import { getErrorMessage } from './utils.js';
import type {
  CodeModeOptions,
  CodeModeResult,
  CompiledContextArtifact,
  NeedContextRequestItem
} from './types.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 32_000;
const MAX_LOG_ENTRIES = 50;

export function getForgeAiCodeModeDts(): string {
  return FORGEAI_CODE_MODE_DTS;
}

export const FORGEAI_CODE_MODE_DTS = `declare const forgeai: {
  try(objective: string, options?: { maxNodes?: number; maxDepth?: number }): {
    objective: string;
    selected: Array<{ node: { path: string; exports: string[]; declarations?: string[] }; score: number; depth: number; reasons: string[] }>;
    excluded_count: number;
    total_indexed_files: number;
    exclusion_ratio: number;
  };
  context(input: string | { objective: string; budget?: number; maxDepth?: number; maxNodes?: number }): CompiledContextArtifact;
  expandContext(requests: Array<{ kind: 'symbol'; name: string; reason: string } | { kind: 'file' | 'test'; path: string; reason: string }>, options?: { budget?: number }): {
    valid: Array<{ requestKind: string; path: string; symbol?: string; reason: string }>;
    rejected: Array<{ reason_code: string; detail: string }>;
    artifact: CompiledContextArtifact | null;
  };
  checkQuality(options?: { files?: string[]; strict?: boolean }): {
    checked_files: string[];
    functions_analyzed: number;
    complex_functions: Array<{ path: string; name: string; start_line: number; complexity: number; crap_score: number | null }>;
    duplicates: Array<{ first: { path: string; name: string }; second: { path: string; name: string }; similarity: number }>;
    passed: boolean;
  };
  diagnostics(): { status: string; diff: string };
  graph(filter?: { pathContains?: string; symbol?: string }): {
    fingerprint: string;
    nodes: Array<{ path: string; exports: string[]; declarations: string[]; language: string }>;
    edges: Array<{ from: string; to: string; kind: string; specifier: string }>;
  };
  symbols(filePath: string): Array<{
    name: string;
    kind: string;
    exported: boolean;
    start_line: number;
    end_line: number;
    signature: string | null;
  }>;
  callers(symbolName: string): {
    symbol: string;
    definitions: string[];
    callers: Array<{ path: string; declarations: string[] }>;
  };
  runCheck(scriptName: 'typecheck' | 'lint' | 'test' | 'build'): {
    name: string;
    passed: boolean;
    durationMs: number;
    output: string;
  };
  writeScope(): string[];
  readScope(): string[];
  changedFiles(): string[];
  readScopedFile(filePath: string): string;
  writeFile(filePath: string, content: string): { path: string; bytes: number };
  editFile(filePath: string, target: string, replacement: string): { path: string; replaced: boolean };
};`;

type SandboxState = {
  repositoryRoot: string;
  primaryArtifact: CompiledContextArtifact | null;
  writeScope: string[];
  readScope: string[];
  changedFiles: Set<string>;
  operations: string[];
  logs: string[];
};

export function clampBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeSafeRepoPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string') throw new Error('path must be a string');
  const trimmed = rawPath.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (!trimmed || trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) {
    throw new Error(`invalid repo-relative path: '${rawPath}'`);
  }
  const segments = trimmed.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`unsafe path traversal in: '${rawPath}'`);
  }
  return segments.join('/');
}

export function isProtectedHarnessPath(normalizedPath: string): boolean {
  return normalizedPath === '.ai'
    || normalizedPath.startsWith('.ai/')
    || normalizedPath === '.git'
    || normalizedPath.startsWith('.git/');
}

function collectAllowedReadScopes(state: SandboxState): string[] {
  const fromArtifact = state.primaryArtifact
    ? state.primaryArtifact.selection.files.map((f) => f.path)
    : [];
  return [...new Set([...state.readScope, ...state.writeScope, ...fromArtifact])];
}

function assertScopeAllowed(rawPath: unknown, mode: 'read' | 'write', state: SandboxState): string {
  const normalized = normalizeSafeRepoPath(rawPath);
  if (isProtectedHarnessPath(normalized)) {
    throw new Error(`${mode} access denied for protected path '${normalized}'`);
  }
  const scopes = mode === 'read' ? collectAllowedReadScopes(state) : state.writeScope;
  const matched = scopes.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
  if (!matched) {
    throw new Error(`${mode} access denied for '${normalized}': path is outside allowed ${mode} scope`);
  }
  return normalized;
}

function resolveProfileRules(repositoryRoot: string) {
  const primaryProfile = detectProjectProfile();
  const available = getAvailableProfiles();
  const components = primaryProfile && available.includes(primaryProfile) ? [primaryProfile] : [];
  return { components, rules: resolveExclusions(components) };
}

function runSandboxTry(objective: unknown, opts: Record<string, unknown> | undefined, state: SandboxState) {
  state.operations.push('try');
  const text = typeof objective === 'string' ? objective.trim() : '';
  if (!text) throw new Error('forgeai.try requires a non-empty objective string');
  const maxNodes = clampBoundedInt(opts?.maxNodes, 12, 1, 50);
  const maxDepth = clampBoundedInt(opts?.maxDepth, 2, 0, 5);
  const depGraph = loadOrGenerateDependencyGraph(state.repositoryRoot);
  const curatedGraph = tryReadCuratedCodeGraph(state.repositoryRoot) ?? normalizeCuratedGraph(null);
  const { rules } = resolveProfileRules(state.repositoryRoot);
  return buildTryReport(text, depGraph, curatedGraph, { maxNodes, maxDepth, rules, includeGlobs: [] });
}

function parseContextArgs(input: unknown): { objective: string; budget: number; maxDepth: number; maxNodes: number } {
  if (typeof input === 'string') {
    const objective = input.trim();
    if (!objective) throw new Error('forgeai.context requires a non-empty objective');
    return { objective, budget: 6000, maxDepth: 2, maxNodes: 12 };
  }
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const objective = typeof obj.objective === 'string' ? obj.objective.trim() : '';
  if (!objective) throw new Error('forgeai.context requires a non-empty objective');
  return {
    objective,
    budget: clampBoundedInt(obj.budget, 6000, 256, 200_000),
    maxDepth: clampBoundedInt(obj.maxDepth, 2, 0, 5),
    maxNodes: clampBoundedInt(obj.maxNodes, 12, 1, 50)
  };
}

function runSandboxContext(input: unknown, state: SandboxState): CompiledContextArtifact {
  state.operations.push('context');
  const parsed = parseContextArgs(input);
  const artifact = compileContextForObjective(parsed.objective, state.repositoryRoot, {
    budget: parsed.budget,
    maxDepth: parsed.maxDepth,
    maxNodes: parsed.maxNodes
  });
  if (!state.primaryArtifact) state.primaryArtifact = artifact;
  return artifact;
}

function recordSandboxExpansionEscapes(
  primary: CompiledContextArtifact,
  rejected: Array<{ item: NeedContextRequestItem; reason_code: string; detail: string; resolvedPath?: string }>,
  repositoryRoot: string
): void {
  if (!primary.task_id) return;
  const digest = artifactDigest(JSON.stringify(primary));
  recordObservation(primary.task_id, { primary_artifact: 'code-mode', primary_digest: digest }, repositoryRoot);
  if (rejected.length === 0) return;
  const entries = rejected.map((r) => ({
    primary_artifact: 'code-mode',
    primary_digest: digest,
    request: r.resolvedPath ? { ...r.item, resolved_path: r.resolvedPath } : r.item,
    reason_code: r.reason_code as Parameters<typeof recordEscapes>[1][number]['reason_code'],
    detail: r.detail
  }));
  recordEscapes(primary.task_id, entries, repositoryRoot);
}

function runSandboxExpand(
  requests: unknown,
  opts: Record<string, unknown> | undefined,
  state: SandboxState
) {
  state.operations.push('expandContext');
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('forgeai.expandContext requires a non-empty array of requests');
  }
  const primary = state.primaryArtifact;
  if (!primary) {
    throw new Error('forgeai.expandContext requires an active primary context artifact (call forgeai.context first)');
  }
  const depGraph = loadOrGenerateDependencyGraph(state.repositoryRoot);
  const curatedGraph = tryReadCuratedCodeGraph(state.repositoryRoot);
  const policy = primary.context_exclusions;
  const { valid, rejected } = validateNeedContext(
    { kind: 'forgeai_need_context', schema_version: 1, artifact: 'code-mode', requests: requests as NeedContextRequestItem[] },
    depGraph,
    curatedGraph,
    policy.rules,
    policy.include_globs
  );
  recordSandboxExpansionEscapes(primary, rejected, state.repositoryRoot);
  if (valid.length === 0) return { valid, rejected, artifact: null };
  const defaultBudget = Math.max(256, primary.budget.limit_tokens - primary.budget.estimated_tokens);
  const budget = clampBoundedInt(opts?.budget, defaultBudget, 256, 200_000);
  const artifact = compileContextExpansion(primary, valid, curatedGraph, depGraph, state.repositoryRoot, {
    budget,
    parentArtifact: 'code-mode',
    effectivePolicy: policy,
    omittedContext: []
  });
  return { valid, rejected, artifact };
}

export function runQualityForOptions(opts: Record<string, unknown> | undefined, repositoryRoot: string) {
  const rawFiles = opts?.files;
  const explicit = Array.isArray(rawFiles)
    ? rawFiles.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : null;
  const files = explicit ?? discoverTargetQualityFiles(repositoryRoot, Boolean(opts?.strict));
  return analyzeFilesQuality(repositoryRoot, files);
}

function runSandboxQuality(opts: Record<string, unknown> | undefined, state: SandboxState) {
  state.operations.push('checkQuality');
  return runQualityForOptions(opts, state.repositoryRoot);
}

function matchesGraphNodeFilter(
  node: { path: string; exports: string[]; declarations?: string[] },
  pathContains: string,
  symbol: string
): boolean {
  const pathOk = !pathContains || node.path.includes(pathContains);
  const decls = node.declarations ?? [];
  const symOk = !symbol || node.exports.includes(symbol) || decls.includes(symbol);
  return pathOk && symOk;
}

function runSandboxGraph(filter: Record<string, unknown> | undefined, state: SandboxState) {
  state.operations.push('graph');
  const depGraph = loadOrGenerateDependencyGraph(state.repositoryRoot);
  const pathContains = typeof filter?.pathContains === 'string' ? filter.pathContains.trim() : '';
  const symbol = typeof filter?.symbol === 'string' ? filter.symbol.trim() : '';
  const nodes = depGraph.nodes
    .filter((node) => matchesGraphNodeFilter(node, pathContains, symbol))
    .map((node) => ({
      path: node.path,
      exports: node.exports,
      declarations: node.declarations ?? [],
      language: node.language ?? 'typescript'
    }));
  const matchedPaths = new Set(nodes.map((n) => n.path));
  const edges = depGraph.edges.filter((edge) => matchedPaths.has(edge.from) || matchedPaths.has(edge.to));
  return { fingerprint: depGraph.repository.fingerprint, nodes, edges };
}

function runSandboxSymbols(rawPath: unknown, state: SandboxState) {
  state.operations.push('symbols');
  const normalized = normalizeSafeRepoPath(rawPath);
  if (isProtectedHarnessPath(normalized)) {
    throw new Error(`symbols access denied for protected path '${normalized}'`);
  }
  const fullPath = path.join(state.repositoryRoot, normalized);
  if (!fs.existsSync(fullPath)) throw new Error(`file not found: '${normalized}'`);
  const parser = parserForFile(normalized);
  if (!parser) throw new Error(`unsupported language for file: '${normalized}'`);
  const content = fs.readFileSync(fullPath, 'utf8');
  const analysis = parser.analyze(content, normalized);
  return analysis.declarations.map((decl) => ({
    name: decl.name,
    kind: decl.kind,
    exported: decl.exported,
    start_line: content.slice(0, Math.max(0, decl.start)).split('\n').length,
    end_line: content.slice(0, Math.max(0, decl.end)).split('\n').length,
    signature: decl.signature
  }));
}

function runSandboxCallers(rawSymbol: unknown, state: SandboxState) {
  state.operations.push('callers');
  const symbol = typeof rawSymbol === 'string' ? rawSymbol.trim() : '';
  if (!symbol) throw new Error('forgeai.callers requires a non-empty symbol name');
  const depGraph = loadOrGenerateDependencyGraph(state.repositoryRoot);
  const definitions = depGraph.nodes
    .filter((node) => node.exports.includes(symbol) || (node.declarations ?? []).includes(symbol))
    .map((node) => node.path);
  const defSet = new Set(definitions);
  const importerPaths = new Set(
    depGraph.edges.filter((edge) => defSet.has(edge.to)).map((edge) => edge.from)
  );
  const callers = depGraph.nodes
    .filter((node) => importerPaths.has(node.path))
    .map((node) => ({ path: node.path, declarations: node.declarations ?? [] }));
  return { symbol, definitions, callers };
}

const ALLOWED_CHECK_SCRIPTS = new Set(['typecheck', 'lint', 'test', 'build']);

function resolveRepoPackageManager(repositoryRoot: string): string {
  const lockMap: ReadonlyArray<readonly [string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun']
  ];
  const found = lockMap.find(([file]) => fs.existsSync(path.join(repositoryRoot, file)));
  return found ? found[1] : 'npm';
}

function runSandboxCheck(rawScript: unknown, state: SandboxState) {
  state.operations.push('runCheck');
  const name = typeof rawScript === 'string' ? rawScript.trim() : '';
  if (!ALLOWED_CHECK_SCRIPTS.has(name)) {
    throw new Error(`forgeai.runCheck only allows: ${[...ALLOWED_CHECK_SCRIPTS].join(', ')}`);
  }
  const pkgPath = path.join(state.repositoryRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error('package.json not found in repository root');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, unknown> };
  if (typeof pkg.scripts?.[name] !== 'string') {
    throw new Error(`script '${name}' is not defined in package.json`);
  }
  const manager = resolveRepoPackageManager(state.repositoryRoot);
  const started = Date.now();
  const res = spawnSync(manager, ['run', name], {
    cwd: state.repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000
  });
  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
  const output = combined.split(/\r?\n/).slice(0, 20).join('\n');
  return {
    name,
    passed: res.status === 0 && !res.error,
    durationMs: Date.now() - started,
    output
  };
}

function runSandboxReadFile(rawPath: unknown, state: SandboxState): string {
  state.operations.push('readScopedFile');
  const normalized = assertScopeAllowed(rawPath, 'read', state);
  const fullPath = path.join(state.repositoryRoot, normalized);
  if (!fs.existsSync(fullPath)) throw new Error(`file not found: '${normalized}'`);
  return fs.readFileSync(fullPath, 'utf8');
}

function runSandboxWriteFile(rawPath: unknown, content: unknown, state: SandboxState) {
  state.operations.push('writeFile');
  if (typeof content !== 'string') throw new Error('forgeai.writeFile content must be a string');
  const normalized = assertScopeAllowed(rawPath, 'write', state);
  const fullPath = path.join(state.repositoryRoot, normalized);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  state.changedFiles.add(normalized);
  return { path: normalized, bytes: Buffer.byteLength(content, 'utf8') };
}

function runSandboxEditFile(rawPath: unknown, target: unknown, replacement: unknown, state: SandboxState) {
  state.operations.push('editFile');
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('forgeai.editFile target must be a non-empty string');
  }
  if (typeof replacement !== 'string') {
    throw new Error('forgeai.editFile replacement must be a string');
  }
  const normalized = assertScopeAllowed(rawPath, 'write', state);
  const fullPath = path.join(state.repositoryRoot, normalized);
  if (!fs.existsSync(fullPath)) throw new Error(`file not found: '${normalized}'`);
  const current = fs.readFileSync(fullPath, 'utf8');
  if (!current.includes(target)) {
    throw new Error(`target string not found in '${normalized}'`);
  }
  const updated = current.replaceAll(target, replacement);
  fs.writeFileSync(fullPath, updated, 'utf8');
  state.changedFiles.add(normalized);
  return { path: normalized, replaced: true };
}

function formatLogArg(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function dispatchHostOperation(op: string, args: unknown[], state: SandboxState): unknown {
  const handlers: Record<string, () => unknown> = {
    try: () => runSandboxTry(args[0], args[1] as Record<string, unknown> | undefined, state),
    context: () => runSandboxContext(args[0], state),
    expandContext: () => runSandboxExpand(args[0], args[1] as Record<string, unknown> | undefined, state),
    checkQuality: () => runSandboxQuality(args[0] as Record<string, unknown> | undefined, state),
    diagnostics: () => {
      state.operations.push('diagnostics');
      return { status: buildStatusSummary(), diff: buildDiffSummary() };
    },
    graph: () => runSandboxGraph(args[0] as Record<string, unknown> | undefined, state),
    symbols: () => runSandboxSymbols(args[0], state),
    callers: () => runSandboxCallers(args[0], state),
    runCheck: () => runSandboxCheck(args[0], state),
    writeScope: () => [...state.writeScope],
    readScope: () => collectAllowedReadScopes(state),
    changedFiles: () => [...state.changedFiles].sort(),
    readScopedFile: () => runSandboxReadFile(args[0], state),
    writeFile: () => runSandboxWriteFile(args[0], args[1], state),
    editFile: () => runSandboxEditFile(args[0], args[1], args[2], state),
    log: () => {
      if (state.logs.length < MAX_LOG_ENTRIES) {
        state.logs.push(args.map(formatLogArg).join(' '));
      }
      return null;
    }
  };
  const fn = handlers[op];
  if (!fn) throw new Error(`unknown sandbox operation: ${op}`);
  return fn();
}

const VM_BOOTSTRAP_SCRIPT = `(function(hostBridge) {
  "use strict";
  const call = (op, args) => {
    const raw = hostBridge(op, JSON.stringify(args));
    const packet = JSON.parse(raw);
    if (!packet.ok) throw new Error(packet.error);
    return packet.value;
  };
  const logFn = (...args) => { call('log', args); };
  globalThis.console = Object.freeze({ log: logFn, info: logFn, warn: logFn, error: logFn });
  globalThis.forgeai = Object.freeze({
    try: (objective, options) => call('try', [objective, options]),
    context: (input) => call('context', [input]),
    expandContext: (requests, options) => call('expandContext', [requests, options]),
    checkQuality: (options) => call('checkQuality', [options]),
    diagnostics: () => call('diagnostics', []),
    graph: (filter) => call('graph', [filter]),
    symbols: (filePath) => call('symbols', [filePath]),
    callers: (symbolName) => call('callers', [symbolName]),
    runCheck: (scriptName) => call('runCheck', [scriptName]),
    writeScope: () => call('writeScope', []),
    readScope: () => call('readScope', []),
    changedFiles: () => call('changedFiles', []),
    readScopedFile: (filePath) => call('readScopedFile', [filePath]),
    writeFile: (filePath, content) => call('writeFile', [filePath, content]),
    editFile: (filePath, target, replacement) => call('editFile', [filePath, target, replacement])
  });
})`;

function installSandboxGlobals(state: SandboxState, context: vm.Context): void {
  const bridge = (op: unknown, rawArgsJson: unknown): string => {
    try {
      const parsedArgs = typeof rawArgsJson === 'string' ? (JSON.parse(rawArgsJson) as unknown[]) : [];
      const value = dispatchHostOperation(String(op), parsedArgs, state);
      return JSON.stringify({ ok: true, value });
    } catch (error) {
      return JSON.stringify({ ok: false, error: getErrorMessage(error) });
    }
  };
  Object.setPrototypeOf(bridge, null);
  const bootstrap = vm.runInContext(VM_BOOTSTRAP_SCRIPT, context) as (fn: typeof bridge) => void;
  bootstrap(bridge);
}

function stripTopLevelAwait(code: string): string {
  const sanitized = stripCommentsAndStrings(code);
  if (!/\bawait\b/.test(sanitized)) return code;
  return code.replace(/\bawait\s+/g, '');
}

function compileSandboxScript(rawCode: string): vm.Script {
  const normalized = stripTopLevelAwait(rawCode);
  try {
    return new vm.Script(normalized, { filename: 'forgeai-code-mode.js' });
  } catch {
    return new vm.Script(`(function() {\n"use strict";\n${normalized}\n})()`, {
      filename: 'forgeai-code-mode.js'
    });
  }
}

function normalizeOutputValue(rawResult: unknown, maxOutputChars: number): unknown {
  if (rawResult === undefined) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(rawResult);
  } catch {
    return String(rawResult).slice(0, maxOutputChars);
  }
  if (!serialized) return null;
  if (serialized.length <= maxOutputChars) return JSON.parse(serialized);
  return {
    truncated: true,
    max_output_chars: maxOutputChars,
    preview: serialized.slice(0, maxOutputChars)
  };
}

export function executeCodeMode(code: string, options: CodeModeOptions = {}): CodeModeResult {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      result: null,
      logs: [],
      changed_files: [],
      operations: [],
      error: 'code is required and must be a non-empty string'
    };
  }
  const timeoutMs = clampBoundedInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxOutputChars = clampBoundedInt(options.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, 256, 200_000);
  const state: SandboxState = {
    repositoryRoot: options.repositoryRoot ?? root,
    primaryArtifact: options.primaryArtifact ?? null,
    writeScope: options.writeScope ?? [],
    readScope: options.readScope ?? [],
    changedFiles: new Set<string>(),
    operations: [],
    logs: []
  };

  const sandbox = Object.create(null) as Record<string, unknown>;
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false }
  });
  installSandboxGlobals(state, context);

  try {
    const script = compileSandboxScript(trimmed);
    const rawResult = script.runInContext(context, { timeout: timeoutMs });
    return {
      ok: true,
      result: normalizeOutputValue(rawResult, maxOutputChars),
      logs: state.logs,
      changed_files: [...state.changedFiles].sort(),
      operations: state.operations,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      result: null,
      logs: state.logs,
      changed_files: [...state.changedFiles].sort(),
      operations: state.operations,
      error: getErrorMessage(error)
    };
  }
}
