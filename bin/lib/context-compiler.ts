import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, getArgValue } from './context.js';
import {
  readCuratedCodeGraph,
  selectContextForObjective,
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
  DependencyGraph
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

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function hashSource(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
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

  const baseEstimate = stableArtifactEstimate(artifact);
  if (baseEstimate > budget) {
    throw new ContextBudgetError(`budget ${budget} is too small for required selection, rules, and diagnostics; minimum is ${baseEstimate}`);
  }

  for (const candidate of candidates) {
    if (tryExcerpt(artifact, candidate.full, candidates.length)) continue;
    if (candidate.signature) tryExcerpt(artifact, candidate.signature, candidates.length);
  }
  artifact.omitted_candidates = candidates.length - artifact.excerpts.length;
  artifact.budget.exhausted = artifact.omitted_candidates > 0 || artifact.excerpts.some((excerpt) => excerpt.mode === 'signature');
  const finalEstimate = stableArtifactEstimate(artifact);
  if (finalEstimate > budget) throw new ContextBudgetError(`compiled artifact exceeded budget ${budget} with estimate ${finalEstimate}`);
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
