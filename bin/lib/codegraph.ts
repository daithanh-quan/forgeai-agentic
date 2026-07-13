import fs from 'node:fs';
import path from 'node:path';
import type { CodeGraph } from './types.js';
import { root } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';
import { parseDateOnly, daysSince } from './lifecycle.js';
import { checkDependencyGraphHealth, DEPENDENCY_GRAPH_PATH, readDependencyGraph } from './dependency-graph.js';

export function isTodoValue(value: unknown): boolean {
  return typeof value === 'string' && /\bTODO\b/i.test(value);
}

export function isTemplateCodeGraph(graph: CodeGraph): boolean {
  if (isTodoValue(graph.generated_at) || isTodoValue(graph.source)) return true;
  const nodeHasTodo = graph.nodes?.some(
    (node) => isTodoValue(node.id) || isTodoValue(node.path) || isTodoValue(node.type) || isTodoValue(node.summary)
  );
  const edgeHasTodo = graph.edges?.some(
    (edge) => isTodoValue(edge.from) || isTodoValue(edge.to) || isTodoValue(edge.kind) || isTodoValue(edge.summary)
  );
  return nodeHasTodo === true || edgeHasTodo === true;
}

export function isValidConfidence(value: string | undefined): boolean {
  return value === 'high' || value === 'medium' || value === 'low';
}

export function runCheckCodeGraph(options: { strict?: boolean } = {}): void {
  console.log('ForgeAI CodeGraph check');
  console.log('');

  const requiredCodeGraphFiles = [
    '.ai/codegraph/README.md',
    '.ai/codegraph/graph.json',
    '.ai/codegraph/hotspots.md',
    '.ai/codegraph/context-packs/_template.md',
    '.ai/workflows/codegraph-context.md'
  ];
  let failures = 0;

  for (const relativePath of requiredCodeGraphFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const graphPath = path.join(root, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('');
    console.log('Result: CodeGraph artifacts are incomplete. Run forgeai-init --upgrade to install them.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Graph metadata');

  let graph: CodeGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as CodeGraph;
  } catch (error) {
    console.log(formatStatus('invalid', `.ai/codegraph/graph.json (${getErrorMessage(error)})`));
    console.log('');
    console.log('Result: CodeGraph JSON is invalid.');
    process.exitCode = 1;
    return;
  }

  if (isTemplateCodeGraph(graph)) {
    console.log(formatStatus('needs bootstrap', '.ai/codegraph/graph.json still contains template TODOs'));
    const dependencyHealth = checkDependencyGraphHealth(root);
    console.log(formatStatus(dependencyHealth.status, dependencyHealth.status === 'ok'
      ? `${DEPENDENCY_GRAPH_PATH} matches current source`
      : dependencyHealth.detail));
    console.log(formatStatus('next', 'populate graph.json before using CodeGraph for risky edits'));
    console.log('');
    console.log('Result: CodeGraph installed, but repository graph still needs bootstrap.');
    if (options.strict) process.exitCode = 1;
    return;
  }

  const dependencyGraph = readDependencyGraph(root);
  const dependencyHealth = checkDependencyGraphHealth(root, dependencyGraph);
  if (dependencyHealth.status !== 'ok') {
    failures += 1;
    console.log(formatStatus(dependencyHealth.status, dependencyHealth.detail));
  } else {
    console.log(formatStatus('ok', `${dependencyGraph!.nodes.length} dependency graph nodes`));
    console.log(formatStatus('ok', `${dependencyGraph!.edges.length} dependency graph edges`));
    console.log(formatStatus('ok', `${DEPENDENCY_GRAPH_PATH} matches current source`));
  }

  if (graph.schema_version !== 1) {
    failures += 1;
    console.log(formatStatus('invalid', `schema_version must be 1, got ${graph.schema_version ?? 'missing'}`));
  } else {
    console.log(formatStatus('ok', 'schema_version: 1'));
  }

  const generatedAt = parseDateOnly(graph.generated_at ?? '');
  if (!generatedAt) {
    failures += 1;
    console.log(formatStatus('invalid', `generated_at must be YYYY-MM-DD, got ${graph.generated_at ?? 'missing'}`));
  } else {
    const ageDays = daysSince(generatedAt);
    if (ageDays < 0) {
      failures += 1;
      console.log(formatStatus('invalid', `generated_at is in the future: ${graph.generated_at}`));
    } else {
      const status = ageDays > 30 ? 'stale' : 'ok';
      if (ageDays > 30) failures += 1;
      console.log(formatStatus(status, `generated_at: ${graph.generated_at} (${ageDays} days old)`));
    }
  }

  if (!graph.source) {
    failures += 1;
    console.log(formatStatus('invalid', 'source is required'));
  } else {
    console.log(formatStatus('ok', `source: ${graph.source}`));
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (!Array.isArray(graph.nodes) || nodes.length === 0) {
    failures += 1;
    console.log(formatStatus('invalid', 'nodes must contain at least one module'));
  } else {
    console.log(formatStatus('ok', `${nodes.length} graph node${nodes.length === 1 ? '' : 's'}`));
  }

  if (!Array.isArray(graph.edges)) {
    failures += 1;
    console.log(formatStatus('invalid', 'edges must be an array'));
  } else {
    console.log(formatStatus('ok', `${edges.length} graph edge${edges.length === 1 ? '' : 's'}`));
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const label = node.id || `node[${index}]`;
    let nodeFailures = 0;

    if (!node.id) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `node[${index}] missing id`));
    } else if (nodeIds.has(node.id)) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${node.id} is duplicated`));
    } else {
      nodeIds.add(node.id);
    }

    if (!node.path) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing path`));
    }
    if (!node.summary) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing summary`));
    }
    if (!isValidConfidence(node.confidence)) {
      nodeFailures += 1;
      console.log(formatStatus('invalid', `${label} confidence must be high, medium, or low`));
    }

    failures += nodeFailures;
  }

  for (const [index, edge] of edges.entries()) {
    const label = `edge[${index}]`;
    let edgeFailures = 0;

    if (!edge.from || !nodeIds.has(edge.from)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} references missing from node: ${edge.from ?? 'missing'}`));
    }
    if (!edge.to || !nodeIds.has(edge.to)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} references missing to node: ${edge.to ?? 'missing'}`));
    }
    if (!edge.kind) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} missing kind`));
    }
    if (!isValidConfidence(edge.confidence)) {
      edgeFailures += 1;
      console.log(formatStatus('invalid', `${label} confidence must be high, medium, or low`));
    }

    failures += edgeFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: CodeGraph needs fixes before graph-guided context selection is reliable.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: CodeGraph is usable for graph-guided context selection.');
}
