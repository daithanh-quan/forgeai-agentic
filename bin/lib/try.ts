import fs from 'node:fs';
import path from 'node:path';
import type { CodeGraph, DependencyGraph } from './types.js';
import { root, rawArgs, validateArgFlag } from './context.js';
import {
  normalizeCuratedGraph,
  selectContextForObjective,
  tryReadCuratedCodeGraph,
  type ContextPackOptions,
  type SelectedContextNode,
} from './context-pack.js';
import { generateDependencyGraph, DEPENDENCY_GRAPH_PATH, readDependencyGraph, checkDependencyGraphHealth } from './dependency-graph.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { resolveExclusions } from './profile-exclusions.js';
import { getErrorMessage, formatBytes } from './utils.js';

export type TryReport = {
  objective: string;
  terms: string[];
  languages: Map<string, number>;
  totalFiles: number;
  selected: SelectedContextNode[];
  omittedCount: number;
  selectedSourceBytes: number;
  totalSourceBytes: number;
};

export type CtaState = 'uninitialized' | 'graph-unreadable' | 'needs-reinit' | 'needs-graph' | 'needs-refresh' | 'ready';

function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectCtaState(projectRoot: string): CtaState {
  const curatedGraphFile = path.join(projectRoot, '.ai', 'codegraph', 'graph.json');
  const depGraphFile = path.join(projectRoot, DEPENDENCY_GRAPH_PATH);

  if (!fs.existsSync(curatedGraphFile)) return 'uninitialized';

  let content: string;
  try {
    content = fs.readFileSync(curatedGraphFile, 'utf-8');
  } catch {
    return 'graph-unreadable';
  }
  try {
    JSON.parse(content);
  } catch {
    return 'needs-reinit';
  }

  if (!fs.existsSync(depGraphFile)) return 'needs-graph';

  const depGraph = readDependencyGraph(projectRoot);
  const health = checkDependencyGraphHealth(projectRoot, depGraph);
  if (health.status !== 'ok') return 'needs-refresh';

  return 'ready';
}

export function parseTryObjective(args: string[]): string | null {
  if (validateArgFlag('--objective', args) !== null) return null;
  const positional = args[1];
  if (positional !== undefined && !positional.startsWith('--')) return positional;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--objective') return args[i + 1] ?? null;
    if (args[i].startsWith('--objective=')) return args[i].slice('--objective='.length);
  }
  return null;
}

export function buildTryReport(
  objective: string,
  depGraph: DependencyGraph,
  curatedGraph: CodeGraph,
  options: ContextPackOptions,
  fileSizer: (relativePath: string) => number = (p) => {
    try { return fs.statSync(path.join(root, p)).size; } catch { return 0; }
  }
): TryReport {
  const safeObjective = sanitizeTerminalText(objective);
  const { terms, selected, omitted } = selectContextForObjective(safeObjective, curatedGraph, depGraph, options);
  const languages = new Map<string, number>();
  for (const node of depGraph.nodes) {
    const lang = node.language ?? 'typescript';
    languages.set(lang, (languages.get(lang) ?? 0) + 1);
  }
  const selectedSourceBytes = selected.reduce((sum, s) => sum + fileSizer(s.node.path), 0);
  const totalSourceBytes = depGraph.nodes.reduce((sum, node) => sum + fileSizer(node.path), 0);
  return { objective: safeObjective, terms, languages, totalFiles: depGraph.nodes.length, selected, omittedCount: omitted.length, selectedSourceBytes, totalSourceBytes };
}

const LANGUAGE_DISPLAY: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python', go: 'Go', rust: 'Rust',
};

function displayLanguage(id: string): string {
  return LANGUAGE_DISPLAY[id] ?? sanitizeTerminalText(id.charAt(0).toUpperCase() + id.slice(1));
}

export function formatTryOutput(report: TryReport, ctaState: CtaState = 'uninitialized'): string {
  const lines: string[] = [];
  const safeObjective = sanitizeTerminalText(report.objective);
  lines.push(`ForgeAI context proof — "${safeObjective}"`);
  lines.push('');
  const langEntries = [...report.languages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const langDisplay = langEntries.map(([id]) => displayLanguage(id)).join(' · ');
  const fileWord = report.totalFiles === 1 ? 'source file' : 'source files';
  lines.push(`  Detected    ${langDisplay || '(none)'}  (${report.totalFiles} ${fileWord})`);
  const selectedCount = report.selected.length;
  lines.push(`  Relevant    ${selectedCount === 0 ? 'none — no objective-matched files' : `${selectedCount} file${selectedCount === 1 ? '' : 's'} selected`}`);
  if (report.omittedCount > 0) lines.push(`  Excluded    ${report.omittedCount} by profile exclusion`);
  if (report.totalSourceBytes > 0) {
    const rawPct = Math.round((1 - report.selectedSourceBytes / report.totalSourceBytes) * 100);
    const pct = Math.max(0, Math.min(100, rawPct));
    lines.push(
      `  Selected    ~${formatBytes(report.selectedSourceBytes)} of ~${formatBytes(report.totalSourceBytes)} indexed source  (${pct}% excluded)`
    );
  }
  lines.push('');
  lines.push('  Included files:');
  lines.push('  ' + '─'.repeat(72));
  if (report.selected.length === 0) {
    lines.push('    (no objective-matched files — refine the objective or check source file names)');
  } else {
    const CONTENT_WIDTH = 72;
    const safePaths = report.selected.map((s) => sanitizeTerminalText(s.node.path));
    const maxPathLen = Math.max(...safePaths.map((p) => p.length));
    const pathColWidth = Math.min(maxPathLen + 2, CONTENT_WIDTH - 20);
    const reasonBudget = CONTENT_WIDTH - pathColWidth;
    for (let i = 0; i < report.selected.length; i++) {
      const p = safePaths[i];
      const displayPath = p.length > pathColWidth - 2 ? p.slice(0, pathColWidth - 5) + '...' : p;
      const padded = displayPath.padEnd(pathColWidth);
      const safeReason = sanitizeTerminalText(report.selected[i].reason);
      const reason = safeReason.length > reasonBudget ? safeReason.slice(0, reasonBudget - 3) + '...' : safeReason;
      lines.push(`    ${padded}${reason}`);
    }
  }
  lines.push('');
  if (ctaState === 'uninitialized') {
    lines.push('  Ready to use ForgeAI on this repository?');
    lines.push('    npx forgeai-agentic-init@latest --profile auto');
    lines.push('    npx forgeai-agentic-init@latest --refresh-codegraph');
    lines.push('    npx forgeai-agentic-init@latest --compile-context --objective "<your objective>"');
  } else if (ctaState === 'graph-unreadable') {
    lines.push('  graph.json cannot be read (permission or I/O error).');
    lines.push('  Check that the file exists and your user has read permission.');
  } else if (ctaState === 'needs-reinit') {
    lines.push('  graph.json is corrupted. To recover (backs up your current file):');
    lines.push('    npx forgeai-agentic-init@latest --repair-codegraph');
  } else if (ctaState === 'needs-graph') {
    lines.push('  ForgeAI is initialized. Build the codegraph to continue:');
    lines.push('    npx forgeai-agentic-init@latest --refresh-codegraph');
  } else if (ctaState === 'needs-refresh') {
    lines.push('  Codegraph is stale or invalid. Refresh it:');
    lines.push('    npx forgeai-agentic-init@latest --refresh-codegraph');
  } else {
    lines.push('  ForgeAI is ready. Compile context for your objective:');
    lines.push('    npx forgeai-agentic-init@latest --compile-context --objective "<your objective>"');
  }
  lines.push('');
  return lines.join('\n');
}

export function runTry(): void {
  const objective = parseTryObjective(rawArgs);
  if (!objective || objective.trim() === '') {
    process.stderr.write('Usage: forgeai-init try "<objective>"\n' + '       forgeai-init try --objective "<description>"\n');
    process.exitCode = 2;
    return;
  }
  let depGraph: DependencyGraph;
  try {
    depGraph = generateDependencyGraph(root);
  } catch (error) {
    process.stderr.write(`Error: could not analyze source files (${getErrorMessage(error)}).\n`);
    process.exitCode = 1;
    return;
  }
  const curatedGraph = tryReadCuratedCodeGraph(root) ?? normalizeCuratedGraph(null);
  const ctaState = detectCtaState(root);
  const primaryProfile = detectProjectProfile();
  const availableSet = new Set(getAvailableProfiles());
  const components = primaryProfile !== null && availableSet.has(primaryProfile) ? [primaryProfile] : [];
  const rules = resolveExclusions(components);
  const report = buildTryReport(objective, depGraph, curatedGraph, { maxNodes: 12, maxDepth: 2, rules, includeGlobs: [] });
  process.stdout.write(formatTryOutput(report, ctaState));
}
