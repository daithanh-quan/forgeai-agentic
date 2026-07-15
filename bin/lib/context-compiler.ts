import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, getArgValue } from './context.js';
import {
  readCuratedCodeGraph,
  selectContextForObjective,
  tokenizeObjective,
  type SelectedContextNode
} from './context-pack.js';
import { analyzeSource, type SourceDeclaration } from './source-analysis.js';
import { collectDiagnostics, selectApplicableRules } from './context-inputs.js';
import {
  checkDependencyGraphHealth,
  readDependencyGraph
} from './dependency-graph.js';
import type {
  CompiledContextArtifact,
  CompiledContextExcerpt,
  DependencyGraph,
  ResolvedContextRequest
} from './types.js';
import { formatStatus, getErrorMessage } from './utils.js';

const DEFAULT_BUDGET = 6000;
const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_DEPTH = 2;
const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;
const MAX_NODES = 50;
const MAX_DEPTH = 5;

type ExcerptCandidate = {
  priority: number;
  full: CompiledContextExcerpt;
  signature: CompiledContextExcerpt | null;
};

export class ContextBudgetError extends Error {}
export class NoNewContextError extends Error {}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function hashSource(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readVerifiedSource(repositoryRoot: string, depNode: { path: string; hash: string }): string {
  const absolutePath = path.join(repositoryRoot, depNode.path);
  const content = fs.readFileSync(absolutePath, 'utf8');
  if (hashSource(content) !== depNode.hash) {
    throw new Error(`${depNode.path} changed after dependency graph validation; run forgeai-init --refresh-codegraph`);
  }
  return content;
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function matchesTerms(values: string[], terms: string[]): boolean {
  const text = values.join(' ').toLowerCase();
  return terms.some((term) => text.includes(term));
}

function excerptFromDeclaration(
  selected: SelectedContextNode,
  declaration: SourceDeclaration,
  content: string,
  mode: 'full' | 'signature',
  reason: string
): CompiledContextExcerpt {
  return {
    path: selected.node.path,
    kind: declaration.kind,
    name: declaration.name,
    reason,
    source_start_line: lineAtOffset(content, declaration.start),
    source_end_line: lineAtOffset(content, Math.max(declaration.start, declaration.end - 1)),
    mode,
    content: mode === 'signature' ? declaration.signature! : content.slice(declaration.start, declaration.end).trim()
  };
}

function candidatesForFile(
  repositoryRoot: string,
  selected: SelectedContextNode,
  terms: string[]
): ExcerptCandidate[] {
  const absolutePath = path.join(repositoryRoot, selected.node.path);
  const content = fs.readFileSync(absolutePath, 'utf8');
  if (hashSource(content) !== selected.node.hash) {
    throw new Error(`${selected.node.path} changed after dependency graph validation; run forgeai-init --refresh-codegraph`);
  }
  const analysis = analyzeSource(content, selected.node.path);
  const candidates: ExcerptCandidate[] = [];
  const declarationSpans = analysis.declarations.map((declaration) => [declaration.start, declaration.end] as const);

  for (const sourceImport of analysis.imports) {
    if (declarationSpans.some(([start, end]) => start <= sourceImport.start && sourceImport.end <= end)) continue;
    const fullContent = content.slice(sourceImport.start, sourceImport.end).trim();
    if (!fullContent) continue;
    candidates.push({
      priority: selected.depth === 0 ? 1 : 3,
      full: {
        path: selected.node.path,
        kind: 'import',
        name: sourceImport.specifier ?? '<dynamic expression>',
        reason: `import required by selected file: ${selected.reason}`,
        source_start_line: lineAtOffset(content, sourceImport.start),
        source_end_line: lineAtOffset(content, Math.max(sourceImport.start, sourceImport.end - 1)),
        mode: 'full',
        content: fullContent
      },
      signature: null
    });
  }

  for (const declaration of analysis.declarations) {
    const objectiveMatch = matchesTerms(declaration.search_names, terms);
    const isSelectedTest = declaration.kind === 'test' && /^test validating /.test(selected.reason);
    if (!objectiveMatch && !declaration.exported && !isSelectedTest) continue;
    const reason = objectiveMatch
      ? `objective matched ${declaration.kind} "${declaration.name}"`
      : `${declaration.kind} retained from ${selected.reason}`;
    const priority = objectiveMatch ? 0 : isSelectedTest ? 1 : selected.depth === 0 ? 2 : 4;
    candidates.push({
      priority,
      full: excerptFromDeclaration(selected, declaration, content, 'full', reason),
      signature: declaration.signature
        ? excerptFromDeclaration(selected, declaration, content, 'signature', `${reason}; body omitted to fit budget`)
        : null
    });
  }

  return candidates;
}

function stableArtifactEstimate(artifact: CompiledContextArtifact): number {
  let estimate = artifact.budget.estimated_tokens;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    artifact.budget.estimated_tokens = estimate;
    const next = estimateTokens(`${JSON.stringify(artifact, null, 2)}\n`);
    if (next === estimate) return next;
    estimate = next;
  }
  artifact.budget.estimated_tokens = estimate;
  return estimateTokens(`${JSON.stringify(artifact, null, 2)}\n`);
}

export function computeArtifactEstimate(artifact: CompiledContextArtifact): number {
  const clone = JSON.parse(JSON.stringify(artifact)) as CompiledContextArtifact;
  let estimate = clone.budget.estimated_tokens;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    clone.budget.estimated_tokens = estimate;
    const next = estimateTokens(`${JSON.stringify(clone, null, 2)}\n`);
    if (next === estimate) return next;
    estimate = next;
  }
  clone.budget.estimated_tokens = estimate;
  return estimateTokens(`${JSON.stringify(clone, null, 2)}\n`);
}

function tryExcerpt(
  artifact: CompiledContextArtifact,
  excerpt: CompiledContextExcerpt,
  candidateCount: number
): boolean {
  const previous = artifact.excerpts;
  artifact.excerpts = [...previous, excerpt];
  artifact.omitted_candidates = candidateCount - artifact.excerpts.length;
  const estimate = stableArtifactEstimate(artifact);
  if (estimate <= artifact.budget.limit_tokens) return true;
  artifact.excerpts = previous;
  artifact.omitted_candidates = candidateCount - previous.length;
  stableArtifactEstimate(artifact);
  return false;
}

function deduplicateCandidates(candidates: ExcerptCandidate[]): ExcerptCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [candidate.full.path, candidate.full.source_start_line, candidate.full.source_end_line, candidate.full.kind].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compileContext(
  objective: string,
  curatedGraph: NonNullable<ReturnType<typeof readCuratedCodeGraph>>,
  dependencyGraph: DependencyGraph,
  repositoryRoot: string,
  options: { budget?: number; maxNodes?: number; maxDepth?: number } = {}
): CompiledContextArtifact {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const selection = selectContextForObjective(objective, curatedGraph, dependencyGraph, { maxNodes, maxDepth });
  const contracts = Array.from(new Set(selection.curated.flatMap((node) => node.public_contracts ?? []))).sort();
  const entrypoints = Array.from(new Set(selection.curated.flatMap((node) => node.entrypoints ?? []))).sort();
  const rules = selectApplicableRules(repositoryRoot, selection.terms);
  const diagnostics = collectDiagnostics(repositoryRoot);
  const candidates = deduplicateCandidates(
    selection.selected.flatMap((selected) => candidatesForFile(repositoryRoot, selected, selection.terms))
  ).sort((a, b) =>
    a.priority - b.priority
    || a.full.path.localeCompare(b.full.path)
    || a.full.source_start_line - b.full.source_start_line
    || a.full.name.localeCompare(b.full.name)
  );

  const artifact: CompiledContextArtifact = {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective,
    repository: {
      revision: dependencyGraph.repository.revision,
      fingerprint: dependencyGraph.repository.fingerprint
    },
    budget: {
      limit_tokens: budget,
      estimated_tokens: 0,
      estimator: 'characters_divided_by_4',
      exhausted: false
    },
    selection: {
      max_depth: maxDepth,
      max_nodes: maxNodes,
      files: selection.selected.map(({ node, depth, reason, graphPath }) => ({
        path: node.path,
        depth,
        reason,
        graph_path: graphPath
      }))
    },
    rules,
    diagnostics,
    contracts,
    entrypoints,
    excerpts: [],
    omitted_candidates: candidates.length
  };

  artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
  const baseEstimate = artifact.budget.estimated_tokens;
  if (baseEstimate > budget) {
    throw new ContextBudgetError(`budget ${budget} is too small for required selection, rules, and diagnostics; minimum is ${baseEstimate}`);
  }

  for (const candidate of candidates) {
    if (tryExcerpt(artifact, candidate.full, candidates.length)) continue;
    if (candidate.signature) tryExcerpt(artifact, candidate.signature, candidates.length);
  }
  artifact.omitted_candidates = candidates.length - artifact.excerpts.length;
  artifact.budget.exhausted = artifact.omitted_candidates > 0 || artifact.excerpts.some((excerpt) => excerpt.mode === 'signature');
  artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
  const finalEstimate = artifact.budget.estimated_tokens;
  if (finalEstimate > budget) throw new ContextBudgetError(`compiled artifact exceeded budget ${budget} with estimate ${finalEstimate}`);
  return artifact;
}

export function compileContextExpansion(
  primary: CompiledContextArtifact,
  requests: ResolvedContextRequest[],
  curatedGraph: ReturnType<typeof readCuratedCodeGraph>,
  dependencyGraph: DependencyGraph,
  repositoryRoot: string,
  options: { budget?: number } = {}
): CompiledContextArtifact {
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budget = options.budget ?? remainingCapacity;
  const terms = tokenizeObjective(primary.objective);

  // Build primary key map: key -> mode
  const primaryModes = new Map<string, 'full' | 'signature'>();
  for (const exc of primary.excerpts) {
    const key = [exc.path, exc.source_start_line, exc.source_end_line, exc.kind].join(':');
    const existing = primaryModes.get(key);
    if (!existing || exc.mode === 'full') primaryModes.set(key, exc.mode);
  }

  // Collect candidates per request, respecting request kind
  const allCandidates: ExcerptCandidate[] = [];
  const seenRequestKeys = new Set<string>();

  for (const request of requests) {
    const reqKey = `${request.requestKind}:${request.path}:${request.symbol ?? ''}`;
    if (seenRequestKeys.has(reqKey)) continue;
    seenRequestKeys.add(reqKey);

    const depNode = dependencyGraph.nodes.find((n) => n.path === request.path);
    if (!depNode) continue;

    // Get raw candidates for the file — hash mismatch propagates as an error
    const fileCandidates = candidatesForFile(
      repositoryRoot,
      { node: depNode, depth: 0, reason: request.reason, graphPath: request.path },
      terms
    );

    if (request.requestKind === 'file') {
      // Force-include ALL declarations (including non-exported ones) plus imports
      const content = readVerifiedSource(repositoryRoot, depNode);
      const analysis = analyzeSource(content, request.path);
      for (const declaration of analysis.declarations) {
        const reason = `${request.reason} (file request)`;
        const selected: SelectedContextNode = { node: depNode, depth: 0, reason, graphPath: request.path };
        allCandidates.push({
          priority: 0,
          full: excerptFromDeclaration(selected, declaration, content, 'full', reason),
          signature: declaration.signature
            ? excerptFromDeclaration(selected, declaration, content, 'signature', `${reason}; body omitted to fit budget`)
            : null
        });
      }
      allCandidates.push(...fileCandidates.filter((c) => c.full.kind === 'import'));
    } else if (request.requestKind === 'test') {
      // Force-include test-kind declarations only
      const content = readVerifiedSource(repositoryRoot, depNode);
      const analysis = analyzeSource(content, request.path);
      for (const declaration of analysis.declarations.filter((d) => d.kind === 'test')) {
        const reason = `${request.reason} (test request)`;
        const selected: SelectedContextNode = { node: depNode, depth: 0, reason, graphPath: request.path };
        allCandidates.push({
          priority: 0,
          full: excerptFromDeclaration(selected, declaration, content, 'full', reason),
          signature: null
        });
      }
      // Non-test declarations go through normal objective matching
      allCandidates.push(...fileCandidates.filter((c) => c.full.kind !== 'test'));
    } else if (request.requestKind === 'symbol') {
      // Force-include declarations whose name matches the symbol
      if (request.symbol) {
        const content = readVerifiedSource(repositoryRoot, depNode);
        const analysis = analyzeSource(content, request.path);
        for (const declaration of analysis.declarations.filter((d) => d.name === request.symbol)) {
          const reason = `${request.reason} (symbol request: ${request.symbol})`;
          const selected: SelectedContextNode = { node: depNode, depth: 0, reason, graphPath: request.path };
          allCandidates.push({
            priority: 0,
            full: excerptFromDeclaration(selected, declaration, content, 'full', reason),
            signature: declaration.signature
              ? excerptFromDeclaration(selected, declaration, content, 'signature', `${reason}; body omitted to fit budget`)
              : null
          });
        }
      }
      // Also include normal objective-matching candidates from this file
      allCandidates.push(...fileCandidates);
    }
  }

  // Apply mode-aware dominance rule against primary
  const dominatedCandidates = allCandidates
    .map((candidate): ExcerptCandidate | null => {
      const key = [candidate.full.path, candidate.full.source_start_line, candidate.full.source_end_line, candidate.full.kind].join(':');
      const primaryMode = primaryModes.get(key);
      if (primaryMode === 'full') return null; // primary already has full — skip
      if (primaryMode === 'signature') {
        // Allow full upgrade; disallow signature retransmission
        return { ...candidate, signature: null };
      }
      return candidate; // absent in primary — keep as-is
    })
    .filter((c): c is ExcerptCandidate => c !== null);

  // Dedup within expansion
  const deduped = deduplicateCandidates(dominatedCandidates);

  if (deduped.length === 0) {
    throw new NoNewContextError('all expansion candidates were already present in the primary artifact at full mode');
  }

  const contracts = Array.from(new Set(primary.contracts)).sort();
  const entrypoints = Array.from(new Set(primary.entrypoints)).sort();

  const artifact: CompiledContextArtifact = {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: `[expansion] ${primary.objective}`,
    repository: primary.repository,
    budget: {
      limit_tokens: budget,
      estimated_tokens: 0,
      estimator: 'characters_divided_by_4',
      exhausted: false
    },
    selection: {
      max_depth: primary.selection.max_depth,
      max_nodes: primary.selection.max_nodes,
      files: Array.from(new Set(deduped.map((c) => c.full.path))).map((p) => ({
        path: p, depth: 0, reason: 'expansion request', graph_path: p
      }))
    },
    rules: [],
    diagnostics: primary.diagnostics,
    contracts,
    entrypoints,
    excerpts: [],
    omitted_candidates: deduped.length
  };

  const baseEstimate = computeArtifactEstimate(artifact);
  if (baseEstimate > budget) {
    throw new ContextBudgetError(`expansion budget ${budget} is too small for base artifact overhead; increase --budget`);
  }

  for (const candidate of deduped) {
    if (tryExcerpt(artifact, candidate.full, deduped.length)) continue;
    if (candidate.signature) tryExcerpt(artifact, candidate.signature, deduped.length);
  }

  if (deduped.length > 0 && artifact.excerpts.length === 0) {
    throw new ContextBudgetError(`expansion budget ${budget} is too small to fit any of the ${deduped.length} candidates; increase --budget`);
  }

  artifact.omitted_candidates = deduped.length - artifact.excerpts.length;
  artifact.budget.exhausted = artifact.omitted_candidates > 0 || artifact.excerpts.some((e) => e.mode === 'signature');
  artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);

  return artifact;
}

function markdownFence(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((value) => value.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function languageForPath(file: string): string {
  const extension = path.extname(file).slice(1);
  return ({ ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript' } as Record<string, string>)[extension] ?? '';
}

export function renderCompiledContextMarkdown(artifact: CompiledContextArtifact): string {
  const files = artifact.selection.files
    .map((file) => `| ${file.path} | ${file.depth} | ${file.reason} | ${file.graph_path} |`)
    .join('\n');
  const excerpts = artifact.excerpts.map((excerpt) => {
    const fence = markdownFence(excerpt.content);
    return `### ${excerpt.path}:${excerpt.source_start_line} — ${excerpt.name}\n\n- Kind: ${excerpt.kind}\n- Mode: ${excerpt.mode}\n- Reason: ${excerpt.reason}\n- Source lines: ${excerpt.source_start_line}-${excerpt.source_end_line}\n\n${fence}${languageForPath(excerpt.path)}\n${excerpt.content}\n${fence}`;
  }).join('\n\n');
  const rules = artifact.rules.map((rule) =>
    `### ${rule.heading}\n\n- Source: ${rule.path}:${rule.source_start_line}-${rule.source_end_line}\n- Reason: ${rule.reason}\n\n${rule.content}`
  ).join('\n\n');
  const diagnosticFence = markdownFence(JSON.stringify(artifact.diagnostics, null, 2));
  return `# ForgeAI Compiled Context\n\n- Objective: ${artifact.objective}\n- Repository fingerprint: ${artifact.repository.fingerprint}\n- Estimated tokens: ${artifact.budget.estimated_tokens}/${artifact.budget.limit_tokens}\n- Estimator: ${artifact.budget.estimator}\n- Omitted candidates: ${artifact.omitted_candidates}\n\n## Selected Files\n\n| Path | Depth | Reason | Graph path |\n| --- | ---: | --- | --- |\n${files || '| none | n/a | no objective match | n/a |'}\n\n## Applicable Rules\n\n${rules || 'No applicable rule section was found.'}\n\n## Diagnostics\n\n${diagnosticFence}json\n${JSON.stringify(artifact.diagnostics, null, 2)}\n${diagnosticFence}\n\n## Contracts\n\n${artifact.contracts.map((value) => `- ${value}`).join('\n') || '- none'}\n\n## Entrypoints\n\n${artifact.entrypoints.map((value) => `- ${value}`).join('\n') || '- none'}\n\n## Source Excerpts\n\n${excerpts || 'No syntax node fit the configured budget.'}\n`;
}

function parseIntegerArg(name: string, fallback: number, minimum: number, maximum: number): number | null {
  const raw = getArgValue(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    console.error(`Error: ${name} must be between ${minimum} and ${maximum}.`);
    process.exitCode = 2;
    return null;
  }
  return value;
}

function markdownOutputPath(jsonOutput: string, explicit: string | null): string {
  if (explicit) return explicit;
  return jsonOutput.toLowerCase().endsWith('.json') ? `${jsonOutput.slice(0, -5)}.md` : `${jsonOutput}.md`;
}

export function runCompileContext(): void {
  const objective = getArgValue('--objective');
  if (!objective) {
    process.stderr.write('Usage: forgeai-init --compile-context --objective "<description>" [--budget <256-200000>] [--max-depth <0-5>] [--max-nodes <1-50>] [--output <json>] [--markdown-output <md>]\n');
    process.exitCode = 2;
    return;
  }
  const budget = parseIntegerArg('--budget', DEFAULT_BUDGET, MIN_BUDGET, MAX_BUDGET);
  const maxDepth = parseIntegerArg('--max-depth', DEFAULT_MAX_DEPTH, 0, MAX_DEPTH);
  const maxNodes = parseIntegerArg('--max-nodes', DEFAULT_MAX_NODES, 1, MAX_NODES);
  if (budget === null || maxDepth === null || maxNodes === null) return;

  const curatedGraph = readCuratedCodeGraph();
  if (!curatedGraph) return;
  const dependencyGraph = readDependencyGraph(root);
  const health = checkDependencyGraphHealth(root, dependencyGraph);
  if (health.status !== 'ok') {
    console.error(`Error: dependency graph is ${health.status} (${health.detail}).`);
    process.exitCode = 1;
    return;
  }

  try {
    const artifact = compileContext(objective, curatedGraph, dependencyGraph!, root, { budget, maxDepth, maxNodes });
    const json = `${JSON.stringify(artifact, null, 2)}\n`;
    const outputArg = getArgValue('--output');
    if (!outputArg) {
      process.stdout.write(json);
      return;
    }
    const jsonPath = path.resolve(root, outputArg);
    const markdownArg = markdownOutputPath(outputArg, getArgValue('--markdown-output'));
    const markdownPath = path.resolve(root, markdownArg);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    fs.writeFileSync(jsonPath, json);
    fs.writeFileSync(markdownPath, renderCompiledContextMarkdown(artifact));
    console.log(formatStatus('ok', `compiled context JSON written to ${outputArg}`));
    console.log(formatStatus('ok', `compiled context Markdown written to ${markdownArg}`));
    console.log(formatStatus('ok', `estimated tokens ${artifact.budget.estimated_tokens}/${artifact.budget.limit_tokens}`));
  } catch (error) {
    console.error(`Error: context compilation failed (${getErrorMessage(error)}).`);
    process.exitCode = error instanceof ContextBudgetError ? 2 : 1;
  }
}
