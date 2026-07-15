import fs from 'node:fs';
import path from 'node:path';
import type {
  NeedContextArtifact,
  NeedContextRequestItem,
  ResolvedContextRequest,
  DependencyGraph
} from './types.js';
import { validateArtifact } from './router.js';
import { compileContextExpansion, renderCompiledContextMarkdown, ContextBudgetError, NoNewContextError } from './context-compiler.js';
import { tryReadCuratedCodeGraph, globMatches } from './context-pack.js';
import { readDependencyGraph, checkDependencyGraphHealth, IGNORED_DIRECTORIES } from './dependency-graph.js';
import { root, getArgValue } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';

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
    if (typeof item !== 'object' || item === null) return 'requests items must be objects';
  }
  return raw as NeedContextArtifact;
}

export function validateNeedContext(
  request: NeedContextArtifact,
  dependencyGraph: DependencyGraph,
  curatedGraph: ReturnType<typeof tryReadCuratedCodeGraph>
): { valid: ResolvedContextRequest[]; rejected: Array<{ item: NeedContextRequestItem; reason: string }> } {
  const depPaths = new Set(dependencyGraph.nodes.map((n) => n.path));
  const ignoredSegments = new Set(IGNORED_DIRECTORIES as readonly string[]);

  function isIgnoredPath(p: string): boolean {
    return p.split('/').some((seg) => ignoredSegments.has(seg));
  }

  const valid: ResolvedContextRequest[] = [];
  const rejected: Array<{ item: NeedContextRequestItem; reason: string }> = [];
  const seenKeys = new Set<string>();

  for (const item of request.requests) {
    if (item.kind === 'file' || item.kind === 'test') {
      if (!isNonEmptyString(item.reason as unknown)) {
        rejected.push({ item, reason: `${item.kind} request must have a non-empty string reason` });
        continue;
      }
      const p = item.path;
      if (!isNonEmptyString(p)) {
        rejected.push({ item, reason: `${item.kind} request must have a non-empty path` });
        continue;
      }
      if (isIgnoredPath(p)) {
        rejected.push({ item, reason: `path '${p}' is in an ignored directory` });
        continue;
      }
      if (!depPaths.has(p)) {
        rejected.push({ item, reason: `path '${p}' not found in dependency graph` });
        continue;
      }
      const key = `${item.kind}:${p}:`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      valid.push({ requestKind: item.kind, path: p, reason: item.reason });
    } else if (item.kind === 'symbol') {
      if (!isNonEmptyString(item.reason as unknown)) {
        rejected.push({ item, reason: 'symbol request must have a non-empty string reason' });
        continue;
      }
      const name = item.name;
      if (!isNonEmptyString(name)) {
        rejected.push({ item, reason: 'symbol request must have a non-empty name' });
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
        rejected.push({ item, reason: `symbol '${name}' not found in dependency graph exports or public_contracts` });
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
      rejected.push({ item, reason: `unknown request kind '${String((item as Record<string, unknown>).kind)}'` });
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
  const { valid, rejected } = validateNeedContext(needContext, depGraph!, curatedGraph);
  for (const r of rejected) {
    process.stderr.write(`${formatStatus('warn', `rejected: ${r.reason}`)}\n`);
  }
  if (valid.length === 0) {
    process.stderr.write('Error: no requests passed validation.\n');
    process.exitCode = 1;
    return;
  }

  // Expansion budget
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budgetArg = getArgValue('--budget');
  let budget: number;
  if (budgetArg !== null) {
    budget = Number(budgetArg);
    if (!Number.isInteger(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) {
      process.stderr.write(`Error: --budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}.\n`);
      process.exitCode = 2;
      return;
    }
  } else {
    if (remainingCapacity < MIN_BUDGET) {
      process.stderr.write(`Error: remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}. Pass --budget explicitly.\n`);
      process.exitCode = 1;
      return;
    }
    budget = remainingCapacity;
  }

  // Step 4: Compile expansion
  let expansion;
  try {
    expansion = compileContextExpansion(primary, valid, curatedGraph, depGraph!, root, { budget });
  } catch (error) {
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
