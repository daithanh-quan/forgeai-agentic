import fs from 'node:fs';
import path from 'node:path';
import type { CodeGraph, CodeGraphNode } from './types.js';
import { root, getArgValue } from './context.js';
import { isTemplateCodeGraph } from './codegraph.js';
import { formatStatus, getErrorMessage } from './utils.js';

const TODAY = new Date().toISOString().slice(0, 10);
const MAX_NODES = 5;

type ScoredNode = {
  node: CodeGraphNode;
  score: number;
  reasons: string[];
};

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3)
    )
  );
}

function joinList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : 'none recorded';
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
      reasons.add('identity/path/tag match');
    }
    if (text.summary.includes(term)) {
      score += 2;
      reasons.add('summary/contract match');
    }
    if (text.relationships.includes(term)) {
      score += 1;
      reasons.add('dependency/dependent match');
    }
  }

  if (score === 0 && node.confidence === 'high') {
    score = 1;
    reasons.add('fallback high-confidence node');
  }

  return { node, score, reasons: Array.from(reasons) };
}

function readCodeGraph(): CodeGraph | null {
  const graphPath = path.join(root, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.error('Error: .ai/codegraph/graph.json not found. Run forgeai-init first and bootstrap CodeGraph before creating a context pack.');
    process.exitCode = 1;
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(graphPath, 'utf8')) as CodeGraph;
  } catch (error) {
    console.error(`Error: .ai/codegraph/graph.json is invalid (${getErrorMessage(error)}).`);
    process.exitCode = 1;
    return null;
  }
}

export function buildContextPack(objective: string, graph: CodeGraph): string {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const terms = tokenize(objective);
  const scored = nodes
    .map((node) => scoreNodeForObjective(node, terms))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.node.id ?? '').localeCompare(b.node.id ?? ''))
    .slice(0, MAX_NODES);

  const relevant = scored.length > 0 ? scored : nodes.slice(0, Math.min(MAX_NODES, nodes.length)).map((node) => ({
    node,
    score: 0,
    reasons: ['fallback first graph nodes']
  }));

  const rows = relevant
    .map(({ node, score, reasons }) => `| ${node.id ?? 'unknown'} | ${node.path ?? 'unknown'} | ${reasons.join('; ')} (score ${score}) | ${node.confidence ?? 'unknown'} |`)
    .join('\n');
  const readFiles = relevant.map(({ node }) => `- ${node.path ?? 'TODO: inspect graph node path'}`).join('\n');
  const contracts = relevant
    .flatMap(({ node }) => node.public_contracts ?? [])
    .map((contract) => `- ${contract}`)
    .join('\n');
  const entrypoints = relevant
    .flatMap(({ node }) => node.entrypoints ?? [])
    .map((entrypoint) => `- ${entrypoint}`)
    .join('\n');

  return `# CodeGraph Context Pack

## Identity

- Objective: ${objective}
- Created: ${TODAY}
- Graph source: \`.ai/codegraph/graph.json\`
- Graph generated at: ${graph.generated_at ?? 'unknown'}
- Graph repository: ${graph.repository?.name ?? 'unknown'}
- Selection terms: ${terms.length > 0 ? terms.join(', ') : 'none'}

## Relevant Nodes

| Node ID | Paths | Why relevant | Confidence |
| --- | --- | --- | --- |
${rows || '| none | none | no graph nodes available | low |'}

## Required Files to Read Before Editing

${readFiles || '- TODO: bootstrap CodeGraph nodes first'}

## Likely Write Scope

${readFiles || '- TODO: define write scope after CodeGraph bootstrap'}

## Contracts and Entrypoints to Preserve

${contracts || '- none recorded'}
${entrypoints ? `\n${entrypoints}` : ''}

## Context Budget

- Start with the files above before broad repository search.
- Add files only when a caller, dependency, failing test, or public contract proves they are needed.
- Keep delegated assignments limited to the selected paths plus explicit validation evidence.

## Unknowns / Follow-Up Reads

- Owners: ${relevant.map(({ node }) => `${node.id ?? 'unknown'}=${joinList(node.owners)}`).join('; ') || 'none recorded'}
- Dependencies: ${relevant.map(({ node }) => `${node.id ?? 'unknown'}=${joinList(node.dependencies)}`).join('; ') || 'none recorded'}
- Dependents: ${relevant.map(({ node }) => `${node.id ?? 'unknown'}=${joinList(node.dependents)}`).join('; ') || 'none recorded'}
`;
}

export function runContextPack(): void {
  const objective = getArgValue('--objective');
  const outputArg = getArgValue('--output');

  if (!objective) {
    process.stderr.write('Usage: forgeai-init --context-pack --objective "<description>" [--output <file>]\n');
    process.exitCode = 2;
    return;
  }

  const graph = readCodeGraph();
  if (!graph) return;

  if (isTemplateCodeGraph(graph)) {
    console.error('Error: .ai/codegraph/graph.json still contains template TODOs. Bootstrap CodeGraph before creating a context pack.');
    process.exitCode = 1;
    return;
  }

  const content = buildContextPack(objective, graph);

  if (outputArg) {
    const outputPath = path.resolve(root, outputArg);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    console.log(formatStatus('ok', `context pack written to ${outputArg}`));
  } else {
    process.stdout.write(content);
  }
}
