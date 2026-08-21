import fs from 'node:fs';
import path from 'node:path';
import type {
  CodeGraph,
  CodeGraphNode,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  ResolvedExclusionRule,
  OmittedContextEntry
} from './types.js';
import { root, getArgValue } from './context.js';
import { isTemplateCodeGraph } from './codegraph.js';
import {
  checkDependencyGraphHealth,
  DEPENDENCY_GRAPH_PATH,
  readDependencyGraph
} from './dependency-graph.js';
import { readManifestResult } from './manifest.js';
import { getAvailableProfiles, normalizeProfile, parseCompositeProfile } from './profiles.js';
import { resolveExclusions, parseIncludeExcluded, matchExclusion } from './profile-exclusions.js';
import { globMatches } from './path-glob.js';
import { formatStatus, getErrorMessage } from './utils.js';

export { globMatches } from './path-glob.js';

function normalizeString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string');
}

export function normalizeCuratedGraph(raw: unknown): CodeGraph {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { nodes: [], edges: [] } as unknown as CodeGraph;
  }
  const obj = raw as Record<string, unknown>;
  const nodes = Array.isArray(obj.nodes)
    ? obj.nodes
        .filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object' && !Array.isArray(n))
        .map((n) => ({
          id: normalizeString(n.id),
          path: normalizeString(n.path),
          type: normalizeString(n.type),
          summary: normalizeString(n.summary),
          confidence: normalizeString(n.confidence),
          owners: normalizeStringArray(n.owners),
          entrypoints: normalizeStringArray(n.entrypoints),
          public_contracts: normalizeStringArray(n.public_contracts),
          dependencies: normalizeStringArray(n.dependencies),
          dependents: normalizeStringArray(n.dependents),
          tags: normalizeStringArray(n.tags),
        }))
    : [];
  const edges = Array.isArray(obj.edges)
    ? obj.edges.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object' && !Array.isArray(e))
    : [];
  return { ...obj, nodes, edges } as unknown as CodeGraph;
}

type ParseCuratedResult =
  | { ok: true; graph: CodeGraph }
  | { ok: false; error: unknown };

function parseCuratedCodeGraph(graphPath: string): ParseCuratedResult {
  try {
    return { ok: true, graph: normalizeCuratedGraph(JSON.parse(fs.readFileSync(graphPath, 'utf8'))) };
  } catch (error) {
    return { ok: false, error };
  }
}

const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_DEPTH = 2;
const MAX_SEEDS = 5;
const MAX_ALLOWED_NODES = 50;
const MAX_ALLOWED_DEPTH = 5;

type ScoredNode = {
  node: CodeGraphNode;
  score: number;
  reasons: string[];
};

type Seed = {
  id: string;
  score: number;
  reasons: string[];
};

export type SelectedContextNode = {
  node: DependencyGraphNode;
  depth: number;
  reason: string;
  graphPath: string;
};

export type DependencyContextSelection = {
  terms: string[];
  selected: SelectedContextNode[];
  curated: CodeGraphNode[];
  omitted: OmittedContextEntry[];
};

export type ContextPackOptions = {
  maxNodes?: number;
  maxDepth?: number;
  rules?: ResolvedExclusionRule[];
  includeGlobs?: string[];
};

export type ResolvedExclusionContext = {
  profiles: string[];
  rules: ResolvedExclusionRule[];
  includeGlobs: string[];
};

/** Resolve the active profile's exclusion policy from the installed manifest and
 *  the optional --include-excluded flag. Returns empty rules when no manifest or
 *  no profile table applies. Throws (via parseIncludeExcluded) on a malformed flag. */
export function resolveExclusionContext(
  includeValue: string | null = getArgValue('--include-excluded')
): ResolvedExclusionContext {
  const manifest = readManifestResult();
  let components: string[] = [];
  if (manifest.state === 'invalid') {
    process.stderr.write(`Warning: invalid .ai/manifest.json: ${manifest.reason}; profile exclusions disabled.\n`);
  } else if (manifest.state === 'valid') {
    if (typeof manifest.data.profile !== 'string') {
      process.stderr.write('Warning: invalid .ai/manifest.json profile; profile exclusions disabled.\n');
    } else {
      const normalized = normalizeProfile(manifest.data.profile);
      if (normalized !== 'base') {
        const parsed = parseCompositeProfile(normalized);
        const available = new Set(getAvailableProfiles());
        const seen = new Set<string>();
        const invalid: string[] = [];
        for (const part of parsed) {
          if (part.length === 0 || part === 'base' || part === 'none' || seen.has(part) || !available.has(part)) {
            invalid.push(part);
          } else {
            seen.add(part);
          }
        }
        components = Array.from(seen).sort((a, b) => a.localeCompare(b));
        if (invalid.length > 0) {
          process.stderr.write(`Warning: manifest profile contains invalid or unknown components (${invalid.map((p) => p || '<empty>').join(', ')}); ignoring them for profile exclusions.\n`);
        }
      }
    }
  }
  return {
    profiles: components,
    rules: resolveExclusions(components),
    includeGlobs: parseIncludeExcluded(includeValue)
  };
}

export function tokenizeObjective(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3)
    )
  );
}

function searchableText(node: CodeGraphNode): Record<string, string> {
  return {
    identity: [node.id, node.path, node.type, ...(node.tags ?? [])].filter(Boolean).join(' ').toLowerCase(),
    summary: [node.summary, ...(node.entrypoints ?? []), ...(node.public_contracts ?? [])].filter(Boolean).join(' ').toLowerCase(),
    relationships: [...(node.dependencies ?? []), ...(node.dependents ?? [])].join(' ').toLowerCase()
  };
}

export function scoreNodeForObjective(node: CodeGraphNode, terms: string[]): ScoredNode {
  const text = searchableText(node);
  let score = 0;
  const reasons = new Set<string>();

  for (const term of terms) {
    if (text.identity.includes(term)) {
      score += 3;
      reasons.add('curated identity/path/tag match');
    }
    if (text.summary.includes(term)) {
      score += 2;
      reasons.add('curated summary/contract match');
    }
    if (text.relationships.includes(term)) {
      score += 1;
      reasons.add('curated relationship match');
    }
  }

  return { node, score, reasons: Array.from(reasons) };
}

function scoreGeneratedNode(node: DependencyGraphNode, terms: string[]): Seed | null {
  const identity = node.path.toLowerCase();
  const exports = node.exports.join(' ').toLowerCase();
  const declNames = new Set((node.declarations ?? []).map((d) => d.toLowerCase()));
  let score = 0;
  const reasons = new Set<string>();
  let declarationMatched = false;
  for (const term of terms) {
    if (identity.includes(term)) {
      score += 3;
      reasons.add('source path match');
    }
    if (exports.includes(term)) {
      score += 2;
      reasons.add('exported symbol match');
    } else if (!declarationMatched && declNames.has(term)) {
      score += 1;
      declarationMatched = true;
      reasons.add('declaration name match');
    }
  }
  return score > 0 ? { id: node.id, score, reasons: Array.from(reasons) } : null;
}

function findSeeds(objective: string, curatedGraph: CodeGraph, dependencyGraph: DependencyGraph): Seed[] {
  const terms = tokenizeObjective(objective);
  const seeds = new Map<string, Seed>();
  const addSeed = (seed: Seed): void => {
    const current = seeds.get(seed.id);
    if (!current) {
      seeds.set(seed.id, seed);
      return;
    }
    current.score += seed.score;
    current.reasons = Array.from(new Set([...current.reasons, ...seed.reasons]));
  };

  for (const node of dependencyGraph.nodes) {
    const scored = scoreGeneratedNode(node, terms);
    if (scored) addSeed(scored);
  }

  if (!isTemplateCodeGraph(curatedGraph)) {
    const curatedMatches = (curatedGraph.nodes ?? [])
      .map((node) => scoreNodeForObjective(node, terms))
      .filter((entry) => entry.score > 0 && entry.node.path);
    for (const entry of curatedMatches) {
      for (const generatedNode of dependencyGraph.nodes) {
        if (globMatches(entry.node.path!, generatedNode.path)) {
          addSeed({ id: generatedNode.id, score: entry.score, reasons: entry.reasons });
        }
      }
    }
  }

  return Array.from(seeds.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function isTestPath(value: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(value);
}

function edgeLabel(edge: DependencyGraphEdge): string {
  return `${edge.kind} "${edge.specifier}"`;
}

function selectDependencyContext(
  seeds: Seed[],
  dependencyGraph: DependencyGraph,
  maxNodes: number,
  maxDepth: number,
  rules: ResolvedExclusionRule[],
  includeGlobs: string[],
  omitted: Map<string, OmittedContextEntry>
): SelectedContextNode[] {
  const nodes = new Map(dependencyGraph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, DependencyGraphEdge[]>();
  const incoming = new Map<string, DependencyGraphEdge[]>();
  for (const edge of dependencyGraph.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }
  for (const edges of [...outgoing.values(), ...incoming.values()]) {
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  }

  // A node matching a profile exclusion is never selected or enqueued, so it
  // cannot consume the maxNodes bound and traversal never crosses it. Objective
  // keyword matching is not an escape hatch: an excluded seed is still omitted.
  const isExcluded = (p: string): boolean => {
    const m = matchExclusion(p, rules, includeGlobs);
    if (m.matched && !omitted.has(p)) {
      omitted.set(p, { path: p, pattern: m.rule.pattern, profiles: m.rule.profiles, reason: m.rule.reason });
    }
    return m.matched;
  };

  const selected = new Map<string, SelectedContextNode>();
  const queue: Array<{ id: string; depth: number; graphPath: string }> = [];
  let acceptedSeeds = 0;
  for (const seed of seeds) {
    if (acceptedSeeds >= Math.min(maxNodes, MAX_SEEDS)) break;
    if (selected.size >= maxNodes) break;
    const node = nodes.get(seed.id);
    if (!node || selected.has(seed.id)) continue;
    if (isExcluded(node.path)) continue;
    const reason = `seed: ${seed.reasons.join('; ')} (score ${seed.score})`;
    selected.set(seed.id, { node, depth: 0, reason, graphPath: seed.id });
    queue.push({ id: seed.id, depth: 0, graphPath: seed.id });
    acceptedSeeds += 1;
  }

  while (queue.length > 0 && selected.size < maxNodes) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const dependencies = (outgoing.get(current.id) ?? []).map((edge) => ({
      id: edge.to,
      edge,
      reason: `dependency of ${current.id}`,
      graphPath: `${current.graphPath} -> ${edge.to}`,
      priority: 1
    }));
    const dependents = (incoming.get(current.id) ?? []).map((edge) => ({
      id: edge.from,
      edge,
      reason: isTestPath(edge.from) ? `test validating ${current.id}` : `dependent of ${current.id}`,
      graphPath: `${edge.from} -> ${current.graphPath}`,
      priority: isTestPath(edge.from) ? 0 : 2
    }));
    const neighbors = [...dependencies, ...dependents]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    for (const neighbor of neighbors) {
      if (selected.size >= maxNodes) break;
      if (selected.has(neighbor.id)) continue;
      const node = nodes.get(neighbor.id);
      if (!node) continue;
      if (isExcluded(node.path)) continue;
      const depth = current.depth + 1;
      selected.set(neighbor.id, {
        node,
        depth,
        reason: `${neighbor.reason} via ${edgeLabel(neighbor.edge)}`,
        graphPath: neighbor.graphPath
      });
      queue.push({ id: neighbor.id, depth, graphPath: neighbor.graphPath });
    }
  }

  return Array.from(selected.values());
}

function relatedCuratedNodes(selected: SelectedContextNode[], curatedGraph: CodeGraph): CodeGraphNode[] {
  if (isTemplateCodeGraph(curatedGraph)) return [];
  return (curatedGraph.nodes ?? []).filter((curated) =>
    curated.path && selected.some((entry) => globMatches(curated.path!, entry.node.path))
  );
}

export function selectContextForObjective(
  objective: string,
  curatedGraph: CodeGraph,
  dependencyGraph: DependencyGraph,
  options: ContextPackOptions = {}
): DependencyContextSelection {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rules = options.rules ?? [];
  const includeGlobs = options.includeGlobs ?? [];
  const terms = tokenizeObjective(objective);
  const seeds = findSeeds(objective, curatedGraph, dependencyGraph);
  const omittedMap = new Map<string, OmittedContextEntry>();
  const selected = selectDependencyContext(seeds, dependencyGraph, maxNodes, maxDepth, rules, includeGlobs, omittedMap);
  const omitted = Array.from(omittedMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  return { terms, selected, curated: relatedCuratedNodes(selected, curatedGraph), omitted };
}

export function buildContextPack(
  objective: string,
  curatedGraph: CodeGraph,
  dependencyGraph: DependencyGraph,
  options: ContextPackOptions = {}
): string {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const { terms, selected, curated, omitted } = selectContextForObjective(objective, curatedGraph, dependencyGraph, options);
  const rows = selected
    .map(({ node, depth, reason, graphPath }) => `| ${node.path} | ${depth} | ${reason} | ${graphPath} |`)
    .join('\n');
  const readFiles = selected.map(({ node }) => `- ${node.path}`).join('\n');
  const omittedRows = omitted
    .map((o) => `| ${o.path} | ${o.pattern} | ${o.reason} | ${o.profiles.join(', ')} |`)
    .join('\n');
  const contracts = Array.from(new Set(curated.flatMap((node) => node.public_contracts ?? [])));
  const entrypoints = Array.from(new Set(curated.flatMap((node) => node.entrypoints ?? [])));
  const revision = dependencyGraph.repository.revision?.slice(0, 12) ?? 'not available';

  return `# CodeGraph Context Pack

## Identity

- Objective: ${objective}
- Dependency graph: \`${DEPENDENCY_GRAPH_PATH}\`
- Dependency graph generated at: ${dependencyGraph.generated_at}
- Repository revision: ${revision}
- Repository fingerprint: ${dependencyGraph.repository.fingerprint.slice(0, 12)}
- Selection terms: ${terms.length > 0 ? terms.join(', ') : 'none'}
- Traversal bounds: depth ${maxDepth}, nodes ${maxNodes}

## Relevant Source Files

| Path | Depth | Why relevant | Graph path |
| --- | ---: | --- | --- |
${rows || '| none | n/a | no objective-matched source seed | n/a |'}

## Required Files to Read Before Editing

${readFiles || '- none selected; refine the objective or refresh source naming/exports before choosing files'}

## Omitted by Profile Exclusion

| Path | Pattern | Reason | Profiles |
| --- | --- | --- | --- |
${omittedRows || '| none | n/a | n/a | n/a |'}

## Likely Write Scope

${readFiles || '- none selected; define write scope after a targeted follow-up search'}

## Contracts and Entrypoints to Preserve

${contracts.map((contract) => `- ${contract}`).join('\n') || '- none recorded'}
${entrypoints.map((entrypoint) => `- ${entrypoint}`).join('\n') || ''}

## Context Budget and Boundary

- Selection starts only from objective-matched source paths, exported symbols, or curated CodeGraph metadata.
- Graph neighbors are included only through recorded local import, dynamic import, or require edges.
- The graph was verified against the current source fingerprint before this pack was created.
- Add files only when direct source evidence proves another caller, dependency, test, or contract is needed.
${selected.length === 0 ? '- No source node matched the objective. ForgeAI did not fall back to confidence or graph order.' : ''}
`;
}

export function readCuratedCodeGraph(repositoryRoot = root): CodeGraph | null {
  const graphPath = path.join(repositoryRoot, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.error('Error: .ai/codegraph/graph.json not found. Run forgeai-init first.');
    process.exitCode = 1;
    return null;
  }
  const result = parseCuratedCodeGraph(graphPath);
  if (!result.ok) {
    console.error(`Error: .ai/codegraph/graph.json is invalid (${getErrorMessage(result.error)}).`);
    process.exitCode = 1;
    return null;
  }
  return result.graph;
}

export function tryReadCuratedCodeGraph(repositoryRoot: string): CodeGraph | null {
  const graphPath = path.join(repositoryRoot, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(graphPath)) return null;
  const result = parseCuratedCodeGraph(graphPath);
  return result.ok ? result.graph : null;
}

function parseBound(name: string, fallback: number, maximum: number): number | null {
  const raw = getArgValue(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > maximum || (name === '--max-nodes' && value === 0)) {
    console.error(`Error: ${name} must be ${name === '--max-nodes' ? 'between 1' : 'between 0'} and ${maximum}.`);
    process.exitCode = 2;
    return null;
  }
  return value;
}

export function runContextPack(): void {
  const objective = getArgValue('--objective');
  const outputArg = getArgValue('--output');
  if (!objective) {
    process.stderr.write('Usage: forgeai-init --context-pack --objective "<description>" [--max-depth <0-5>] [--max-nodes <1-50>] [--include-excluded "<glob>[,<glob>...]"] [--output <file>]\n');
    process.exitCode = 2;
    return;
  }
  const maxDepth = parseBound('--max-depth', DEFAULT_MAX_DEPTH, MAX_ALLOWED_DEPTH);
  const maxNodes = parseBound('--max-nodes', DEFAULT_MAX_NODES, MAX_ALLOWED_NODES);
  if (maxDepth === null || maxNodes === null) return;

  let exclusions: ResolvedExclusionContext;
  try {
    exclusions = resolveExclusionContext();
  } catch (error) {
    console.error(`Error: ${getErrorMessage(error)}`);
    process.exitCode = 2;
    return;
  }

  const curatedGraph = readCuratedCodeGraph();
  if (!curatedGraph) return;
  const dependencyGraph = readDependencyGraph(root);
  const health = checkDependencyGraphHealth(root, dependencyGraph);
  if (health.status !== 'ok') {
    console.error(`Error: dependency graph is ${health.status} (${health.detail}).`);
    process.exitCode = 1;
    return;
  }

  const content = buildContextPack(objective, curatedGraph, dependencyGraph!, {
    maxDepth,
    maxNodes,
    rules: exclusions.rules,
    includeGlobs: exclusions.includeGlobs
  });
  if (outputArg) {
    const outputPath = path.resolve(root, outputArg);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    console.log(formatStatus('ok', `context pack written to ${outputArg}`));
  } else {
    process.stdout.write(content);
  }
}
