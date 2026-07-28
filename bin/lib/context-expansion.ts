import fs from 'node:fs';
import path from 'node:path';
import type {
  NeedContextArtifact,
  NeedContextRequestItem,
  ResolvedContextRequest,
  DependencyGraph,
  EscapeReasonCode
} from './types.js';
import { validateArtifact } from './router.js';
import { compileContextExpansion, renderCompiledContextMarkdown, ContextBudgetError, NoNewContextError } from './context-compiler.js';
import { tryReadCuratedCodeGraph, globMatches } from './context-pack.js';
import { readDependencyGraph, checkDependencyGraphHealth, IGNORED_DIRECTORIES } from './dependency-graph.js';
import { artifactDigest, recordEscapes, recordObservation, type NewEscape } from './context-escapes.js';
import { root, getArgValue } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';

// Maps a resolved request back to a request snapshot for whole-set escapes.
function resolvedToRequestItem(r: ResolvedContextRequest): NeedContextRequestItem {
  return r.requestKind === 'symbol'
    ? { kind: 'symbol', name: r.symbol!, reason: r.reason }
    : { kind: r.requestKind, path: r.path, reason: r.reason };
}

const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateNeedContextSchema(raw: unknown): NeedContextArtifact | string {
  if (typeof raw !== 'object' || raw === null) return 'need_context is not an object';
  const n = raw as Record<string, unknown>;
  if (n.kind !== 'forgeai_need_context') return "kind must be 'forgeai_need_context'";
  if (n.schema_version !== 1) return 'schema_version must be 1';
  if (!isNonEmptyString(n.artifact)) return 'artifact must be a non-empty string';
  if (!Array.isArray(n.requests) || n.requests.length === 0) return 'requests must be a non-empty array';
  for (const item of n.requests as unknown[]) {
    // Reject arrays too: an array item would fall through to `unknown_kind`, be
    // persisted as an escape with `request: []`, and then be rejected on read
    // (arrays are not plain objects) — corrupting the store so --evaluate always
    // reports it malformed.
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return 'requests items must be objects';
  }
  return raw as NeedContextArtifact;
}

export function validateNeedContext(
  request: NeedContextArtifact,
  dependencyGraph: DependencyGraph,
  curatedGraph: ReturnType<typeof tryReadCuratedCodeGraph>
): { valid: ResolvedContextRequest[]; rejected: Array<{ item: NeedContextRequestItem; reason_code: EscapeReasonCode; detail: string }> } {
  const depPaths = new Set(dependencyGraph.nodes.map((n) => n.path));
  const ignoredSegments = new Set(IGNORED_DIRECTORIES as readonly string[]);

  function isIgnoredPath(p: string): boolean {
    return p.split('/').some((seg) => ignoredSegments.has(seg));
  }

  const valid: ResolvedContextRequest[] = [];
  const rejected: Array<{ item: NeedContextRequestItem; reason_code: EscapeReasonCode; detail: string }> = [];
  const seenKeys = new Set<string>();

  for (const item of request.requests) {
    if (item.kind === 'file' || item.kind === 'test') {
      if (!isNonEmptyString(item.reason as unknown)) {
        rejected.push({ item, reason_code: 'missing_reason', detail: `${item.kind} request must have a non-empty string reason` });
        continue;
      }
      const p = item.path;
      if (!isNonEmptyString(p)) {
        rejected.push({ item, reason_code: 'missing_path', detail: `${item.kind} request must have a non-empty path` });
        continue;
      }
      if (isIgnoredPath(p)) {
        rejected.push({ item, reason_code: 'ignored_path', detail: `path '${p}' is in an ignored directory` });
        continue;
      }
      if (!depPaths.has(p)) {
        rejected.push({ item, reason_code: 'path_not_in_graph', detail: `path '${p}' not found in dependency graph` });
        continue;
      }
      const key = `${item.kind}:${p}:`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      valid.push({ requestKind: item.kind, path: p, reason: item.reason });
    } else if (item.kind === 'symbol') {
      if (!isNonEmptyString(item.reason as unknown)) {
        rejected.push({ item, reason_code: 'missing_reason', detail: 'symbol request must have a non-empty string reason' });
        continue;
      }
      const name = item.name;
      if (!isNonEmptyString(name)) {
        rejected.push({ item, reason_code: 'missing_name', detail: 'symbol request must have a non-empty name' });
        continue;
      }
      const resolvedPaths: string[] = [];
      // Search dependency graph exports
      for (const node of dependencyGraph.nodes) {
        if (node.exports.includes(name)) resolvedPaths.push(node.path);
      }
      // Search curated graph public_contracts — expand glob patterns against dep graph nodes
      if (curatedGraph) {
        for (const curatedNode of curatedGraph.nodes ?? []) {
          if (!curatedNode.path || !(curatedNode.public_contracts ?? []).includes(name)) continue;
          for (const depNode of dependencyGraph.nodes) {
            if (
              (curatedNode.path === depNode.path || globMatches(curatedNode.path, depNode.path)) &&
              !resolvedPaths.includes(depNode.path)
            ) {
              resolvedPaths.push(depNode.path);
            }
          }
        }
      }
      if (resolvedPaths.length === 0) {
        rejected.push({ item, reason_code: 'symbol_not_found', detail: `symbol '${name}' not found in dependency graph exports or public_contracts` });
        continue;
      }
      for (const p of resolvedPaths) {
        if (isIgnoredPath(p)) continue;
        const key = `symbol:${p}:${name}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        valid.push({ requestKind: 'symbol', path: p, symbol: name, reason: item.reason });
      }
    } else {
      rejected.push({ item, reason_code: 'unknown_kind', detail: `unknown request kind '${String((item as Record<string, unknown>).kind)}'` });
    }
  }
  return { valid, rejected };
}

export function runExpandContext(): void {
  const artifactArg = getArgValue('--artifact');
  const needContextArg = getArgValue('--need-context');
  if (!artifactArg || !needContextArg) {
    process.stderr.write('Usage: forgeai-init --expand-context --artifact <path> --need-context <path> [--budget <tokens>] [--output <json>]\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const needContextPath = path.resolve(root, needContextArg);

  // Step 1: Validate primary artifact
  const primaryResult = validateArtifact(artifactPath, root);
  if (primaryResult.status !== 'ok') {
    process.stderr.write(`Error: ${primaryResult.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const primary = primaryResult.artifact;

  // Boundary guards: an escape must attribute to exactly one in-repo primary.
  if (primary.artifact_role === 'expansion') {
    process.stderr.write('Error: --artifact must be a primary compiled-context artifact; expansion-of-expansion is not supported.\n');
    process.exitCode = 1;
    return;
  }
  // Normalize via realpath so a symlinked temp/root (e.g. macOS /var -> /private/var)
  // does not read as out-of-root; the primary file exists (validateArtifact passed).
  const realRoot = fs.realpathSync(root);
  let realArtifact: string;
  try { realArtifact = fs.realpathSync(artifactPath); } catch { realArtifact = artifactPath; }
  const parentRel = path.relative(realRoot, realArtifact).split(path.sep).join('/');
  // Reject only real traversal — a file literally named e.g. "..cache/x.json"
  // inside the repo is fine, but "..", "../…", or an absolute path is not.
  if (parentRel === '' || parentRel === '..' || parentRel.startsWith('../') || path.isAbsolute(parentRel)) {
    process.stderr.write('Error: --artifact must resolve inside the repository root.\n');
    process.exitCode = 1;
    return;
  }

  // Step 2: Validate need_context schema
  let rawNeedContext: unknown;
  try {
    rawNeedContext = JSON.parse(fs.readFileSync(needContextPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Error: cannot parse need_context: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const needContextOrError = validateNeedContextSchema(rawNeedContext);
  if (typeof needContextOrError === 'string') {
    process.stderr.write(`Error: invalid need_context: ${needContextOrError}\n`);
    process.exitCode = 1;
    return;
  }
  const needContext = needContextOrError;

  // Step 3: Load graphs and resolve requests
  const depGraph = readDependencyGraph(root);
  const health = checkDependencyGraphHealth(root, depGraph);
  if (health.status !== 'ok') {
    process.stderr.write(`Error: dependency graph is ${health.status}: ${health.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const curatedGraph = tryReadCuratedCodeGraph(root);

  // Syntactic --budget validation first (usage error, exit 2) — no side effects yet.
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budgetArg = getArgValue('--budget');
  let explicitBudget: number | null = null;
  if (budgetArg !== null) {
    const parsed = Number(budgetArg);
    if (!Number.isInteger(parsed) || parsed < MIN_BUDGET || parsed > MAX_BUDGET) {
      process.stderr.write(`Error: --budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}.\n`);
      process.exitCode = 2;
      return;
    }
    explicitBudget = parsed;
  }

  // Preconditions passed: record the observation for this primary (once, idempotent).
  const primaryDigest = artifactDigest(fs.readFileSync(artifactPath, 'utf8'));
  if (primary.task_id !== null) {
    recordObservation(primary.task_id, { primary_artifact: parentRel, primary_digest: primaryDigest }, root);
  }

  // Resolve requests and record per-request escapes.
  const { valid, rejected } = validateNeedContext(needContext, depGraph!, curatedGraph);
  const escapes: NewEscape[] = [];
  for (const r of rejected) {
    process.stderr.write(`${formatStatus('warn', `rejected: ${r.detail}`)}\n`);
    escapes.push({ primary_artifact: parentRel, primary_digest: primaryDigest, request: r.item, reason_code: r.reason_code, detail: r.detail });
  }
  if (primary.task_id !== null && escapes.length > 0) {
    recordEscapes(primary.task_id, escapes, root);
  }
  if (valid.length === 0) {
    process.stderr.write('Error: no requests passed validation.\n');
    process.exitCode = 1;
    return;
  }

  // Resolve the effective budget (capacity too small is a real escape).
  let budget: number;
  if (explicitBudget !== null) {
    budget = explicitBudget;
  } else {
    if (remainingCapacity < MIN_BUDGET) {
      if (primary.task_id !== null) {
        recordEscapes(primary.task_id, valid.map((r) => ({
          primary_artifact: parentRel, primary_digest: primaryDigest, request: resolvedToRequestItem(r),
          reason_code: 'budget_exceeded' as EscapeReasonCode,
          detail: `remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}`,
        })), root);
      }
      process.stderr.write(`Error: remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}. Pass --budget explicitly.\n`);
      process.exitCode = 1;
      return;
    }
    budget = remainingCapacity;
  }

  // Step 4: Compile expansion
  let expansion;
  try {
    expansion = compileContextExpansion(primary, valid, curatedGraph, depGraph!, root, { budget, parentArtifact: parentRel });
  } catch (error) {
    let code: EscapeReasonCode | null = null;
    if (error instanceof ContextBudgetError) code = 'budget_exceeded';
    else if (error instanceof NoNewContextError) code = 'no_new_context';
    if (code && primary.task_id !== null) {
      recordEscapes(primary.task_id, valid.map((r) => ({
        primary_artifact: parentRel, primary_digest: primaryDigest, request: resolvedToRequestItem(r),
        reason_code: code!, detail: error instanceof Error ? error.message : String(error),
      })), root);
    }
    if (error instanceof ContextBudgetError) {
      process.stderr.write(`Error: expansion budget is too small for the requested context; increase --budget.\n`);
      process.exitCode = 2;
    } else if (error instanceof NoNewContextError) {
      process.stderr.write('Error: requests produced no new context after deduplication against the primary artifact.\n');
      process.exitCode = 1;
    } else {
      process.stderr.write(`Error: expansion failed: ${getErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const json = `${JSON.stringify(expansion, null, 2)}\n`;
  const outputArg = getArgValue('--output');
  if (!outputArg) {
    process.stdout.write(json);
    return;
  }
  const jsonPath = path.resolve(root, outputArg);
  const explicitMarkdown = getArgValue('--markdown-output');
  const markdownArg = explicitMarkdown ?? (
    outputArg.toLowerCase().endsWith('.json')
      ? `${outputArg.slice(0, -5)}.md`
      : `${outputArg}.md`
  );
  const markdownPath = path.resolve(root, markdownArg);
  if (jsonPath === markdownPath) {
    process.stderr.write('Error: --output and --markdown-output resolve to the same path; provide distinct paths.\n');
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(markdownPath, renderCompiledContextMarkdown(expansion));
  process.stderr.write(`${formatStatus('ok', `expansion JSON written to ${outputArg}`)}\n`);
  process.stderr.write(`${formatStatus('ok', `expansion Markdown written to ${markdownArg}`)}\n`);
  process.stderr.write(`${formatStatus('ok', `estimated tokens ${expansion.budget.estimated_tokens}/${expansion.budget.limit_tokens}`)}\n`);
}
