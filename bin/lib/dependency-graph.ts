import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSource } from './source-analysis.js';
import { root } from './context.js';
import type {
  DependencyEdgeKind,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  UnresolvedDependency
} from './types.js';
import { formatStatus, getErrorMessage } from './utils.js';

export const DEPENDENCY_GRAPH_PATH = '.ai/codegraph/dependency-graph.json';
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;
export const IGNORED_DIRECTORIES = [
  '.ai',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor'
] as const;

type ImportReference = {
  kind: DependencyEdgeKind;
  specifier?: string;
};

type SourceInventory = {
  files: string[];
  hashes: Map<string, string>;
  fingerprint: string;
};

export type DependencyGraphHealth =
  | { status: 'ok'; inventory: SourceInventory }
  | { status: 'missing'; detail: string }
  | { status: 'invalid'; detail: string }
  | { status: 'stale'; detail: string };

function normalizePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function isSourceFile(relativePath: string): boolean {
  if (relativePath.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.includes(path.extname(relativePath) as (typeof SOURCE_EXTENSIONS)[number]);
}

function isIgnored(relativePath: string): boolean {
  const segments = normalizePath(relativePath).split('/');
  return segments.some((segment) => IGNORED_DIRECTORIES.includes(segment as (typeof IGNORED_DIRECTORIES)[number]));
}

function walkSourceFiles(directory: string, repositoryRoot: string, output: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = normalizePath(path.relative(repositoryRoot, absolutePath));
    if (isIgnored(relativePath)) continue;
    if (entry.isDirectory()) walkSourceFiles(absolutePath, repositoryRoot, output);
    else if (entry.isFile() && isSourceFile(relativePath)) output.push(relativePath);
  }
}

function listSourceFiles(repositoryRoot: string): string[] {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return output
      .split(/\r?\n/)
      .map(normalizePath)
      .filter((file) => {
        if (file.length === 0 || !isSourceFile(file) || isIgnored(file)) return false;
        try {
          return fs.statSync(path.join(repositoryRoot, file)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    const files: string[] = [];
    walkSourceFiles(repositoryRoot, repositoryRoot, files);
    return files.sort();
  }
}

function hashSource(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function buildSourceInventory(repositoryRoot: string): SourceInventory {
  const files = listSourceFiles(repositoryRoot);
  const hashes = new Map<string, string>();
  const fingerprint = crypto.createHash('sha256');
  for (const file of files) {
    const hash = hashSource(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'));
    hashes.set(file, hash);
    fingerprint.update(file).update('\0').update(hash).update('\0');
  }
  return { files, hashes, fingerprint: fingerprint.digest('hex') };
}

function parseModule(content: string, file: string): { imports: ImportReference[]; exports: string[] } {
  const analysis = analyzeSource(content, file);
  return { imports: analysis.imports, exports: analysis.exports };
}

function resolutionCandidates(importer: string, specifier: string): string[] {
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier)));
  const extension = path.posix.extname(base);
  const candidates = new Set<string>();
  if (extension && SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])) {
    candidates.add(base);
    const withoutExtension = base.slice(0, -extension.length);
    for (const sourceExtension of SOURCE_EXTENSIONS) candidates.add(`${withoutExtension}${sourceExtension}`);
  } else {
    candidates.add(base);
    for (const sourceExtension of SOURCE_EXTENSIONS) candidates.add(`${base}${sourceExtension}`);
    for (const sourceExtension of SOURCE_EXTENSIONS) candidates.add(`${base}/index${sourceExtension}`);
  }
  return Array.from(candidates);
}

function resolveLocalImport(importer: string, specifier: string, sourceFiles: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  return resolutionCandidates(importer, specifier).find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function getGitRevision(repositoryRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null;
  } catch {
    return null;
  }
}

export function generateDependencyGraph(repositoryRoot: string): DependencyGraph {
  const inventory = buildSourceInventory(repositoryRoot);
  const sourceFiles = new Set(inventory.files);
  const nodes: DependencyGraphNode[] = [];
  const edges: DependencyGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const unresolved: UnresolvedDependency[] = [];

  for (const file of inventory.files) {
    const content = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
    const parsed = parseModule(content, file);
    nodes.push({ id: file, path: file, hash: inventory.hashes.get(file)!, exports: parsed.exports });

    for (const reference of parsed.imports) {
      if (!reference.specifier) {
        unresolved.push({ from: file, kind: reference.kind, specifier: '<expression>', reason: 'dynamic_expression' });
        continue;
      }
      if (!reference.specifier.startsWith('.')) {
        unresolved.push({ from: file, kind: reference.kind, specifier: reference.specifier, reason: 'external_package' });
        continue;
      }
      const target = resolveLocalImport(file, reference.specifier, sourceFiles);
      if (!target) {
        unresolved.push({ from: file, kind: reference.kind, specifier: reference.specifier, reason: 'unresolved_local' });
        continue;
      }
      const edgeKey = `${file}\0${target}\0${reference.kind}\0${reference.specifier}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({ from: file, to: target, kind: reference.kind, specifier: reference.specifier });
      }
    }
  }

  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  unresolved.sort((a, b) => a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier));
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: 'forgeai-static-analysis',
    repository: { root: '.', revision: getGitRevision(repositoryRoot), fingerprint: inventory.fingerprint },
    settings: { extensions: [...SOURCE_EXTENSIONS], ignored_directories: [...IGNORED_DIRECTORIES] },
    nodes,
    edges,
    unresolved
  };
}

function isDependencyGraph(value: unknown): value is DependencyGraph {
  if (!value || typeof value !== 'object') return false;
  const graph = value as Partial<DependencyGraph>;
  if (!(graph.schema_version === 1
    && graph.source === 'forgeai-static-analysis'
    && typeof graph.generated_at === 'string'
    && !Number.isNaN(Date.parse(graph.generated_at))
    && graph.repository?.root === '.'
    && (graph.repository.revision === null || typeof graph.repository.revision === 'string')
    && typeof graph.repository.fingerprint === 'string'
    && /^[a-f0-9]{64}$/.test(graph.repository.fingerprint)
    && Array.isArray(graph.settings?.extensions)
    && Array.isArray(graph.settings?.ignored_directories)
    && Array.isArray(graph.nodes)
    && Array.isArray(graph.edges)
    && Array.isArray(graph.unresolved))) return false;

  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.path !== 'string' || node.id !== node.path) return false;
    if (!/^[a-f0-9]{64}$/.test(node.hash) || !Array.isArray(node.exports) || !node.exports.every((entry) => typeof entry === 'string')) return false;
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
  }
  const kinds = new Set<DependencyEdgeKind>(['static_import', 'dynamic_import', 'require']);
  if (!graph.edges.every((edge) => edge
    && nodeIds.has(edge.from)
    && nodeIds.has(edge.to)
    && kinds.has(edge.kind)
    && typeof edge.specifier === 'string')) return false;
  return graph.unresolved.every((entry) => entry
    && nodeIds.has(entry.from)
    && kinds.has(entry.kind)
    && typeof entry.specifier === 'string'
    && ['dynamic_expression', 'external_package', 'unresolved_local'].includes(entry.reason));
}

export function readDependencyGraph(repositoryRoot: string): DependencyGraph | null {
  const graphPath = path.join(repositoryRoot, DEPENDENCY_GRAPH_PATH);
  if (!fs.existsSync(graphPath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    return isDependencyGraph(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function checkDependencyGraphHealth(repositoryRoot: string, graph = readDependencyGraph(repositoryRoot)): DependencyGraphHealth {
  if (!fs.existsSync(path.join(repositoryRoot, DEPENDENCY_GRAPH_PATH))) {
    return { status: 'missing', detail: `${DEPENDENCY_GRAPH_PATH} not found; run forgeai-init --refresh-codegraph` };
  }
  if (!graph) return { status: 'invalid', detail: `${DEPENDENCY_GRAPH_PATH} is invalid; run forgeai-init --refresh-codegraph` };
  const inventory = buildSourceInventory(repositoryRoot);
  if (inventory.fingerprint !== graph.repository.fingerprint) {
    return { status: 'stale', detail: 'source file set or contents changed; run forgeai-init --refresh-codegraph' };
  }
  if (graph.nodes.length !== inventory.files.length || graph.nodes.some((node) => inventory.hashes.get(node.path) !== node.hash)) {
    return { status: 'stale', detail: 'generated nodes do not match current source hashes; run forgeai-init --refresh-codegraph' };
  }
  return { status: 'ok', inventory };
}

export function runRefreshCodeGraph(): void {
  const curatedGraphPath = path.join(root, '.ai', 'codegraph', 'graph.json');
  if (!fs.existsSync(curatedGraphPath)) {
    console.error('Error: .ai/codegraph/graph.json not found. Run forgeai-init before refreshing CodeGraph.');
    process.exitCode = 1;
    return;
  }
  let temporaryPath: string | null = null;
  try {
    const graph = generateDependencyGraph(root);
    const outputPath = path.join(root, DEPENDENCY_GRAPH_PATH);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    temporaryPath = `${outputPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(graph, null, 2)}\n`);
    fs.renameSync(temporaryPath, outputPath);
    temporaryPath = null;
    console.log('ForgeAI dependency graph refresh');
    console.log('');
    console.log(formatStatus('ok', `${graph.nodes.length} source file${graph.nodes.length === 1 ? '' : 's'}`));
    console.log(formatStatus('ok', `${graph.edges.length} local dependency edge${graph.edges.length === 1 ? '' : 's'}`));
    const unresolvedLocal = graph.unresolved.filter((entry) => entry.reason === 'unresolved_local').length;
    console.log(formatStatus(unresolvedLocal === 0 ? 'ok' : 'warning', `${unresolvedLocal} unresolved local import${unresolvedLocal === 1 ? '' : 's'}`));
    console.log(formatStatus('ok', `wrote ${DEPENDENCY_GRAPH_PATH}`));
  } catch (error) {
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    console.error(`Error: dependency graph refresh failed (${getErrorMessage(error)}). Existing graph was not replaced.`);
    process.exitCode = 1;
  }
}

