import readline from 'node:readline';
import { root } from './context.js';
import { analyzeFilesQuality, discoverTargetQualityFiles } from './code-quality.js';
import { compileContextForObjective, formatContextCommandOutput } from './context-command.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph } from './context-pack.js';
import { loadOrGenerateDependencyGraph } from './dependency-graph.js';
import { buildDiffSummary, buildStatusSummary } from './diagnostics.js';
import { resolveExclusions } from './profile-exclusions.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { buildTryReport, detectCtaState, formatTryOutput } from './try.js';
import { getErrorMessage, getPackageVersion } from './utils.js';

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
};

const MCP_TOOLS = [
  {
    name: 'forgeai_context',
    description:
      'Compile bounded, AST-level source excerpts, applicable rules, and line provenance for an objective without reading the whole repository.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Task objective, bug description, or symbol/file names' },
        budget: { type: 'integer', minimum: 256, maximum: 200000, description: 'Estimated token budget (default 6000)' },
        max_depth: { type: 'integer', minimum: 0, maximum: 5, description: 'Dependency traversal depth (default 2)' },
        max_nodes: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum files selected (default 12)' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format (default markdown)' }
      },
      required: ['objective']
    }
  },
  {
    name: 'forgeai_try',
    description: 'Preview which source files match an objective and see the source exclusion ratio before reading files.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Task objective or symbol/file names to preview' }
      },
      required: ['objective']
    }
  },
  {
    name: 'forgeai_check_quality',
    description:
      'Validate modified or specified source files for cyclomatic complexity (< 10), LCOV CRAP score (< 10), and structural duplication (< 0.8).',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional repo-relative file paths; defaults to git modified files'
        },
        strict: { type: 'boolean', description: 'Scan all repository source files when true' }
      }
    }
  },
  {
    name: 'forgeai_diagnostics',
    description: 'Return compact git status and diff summaries for the repository.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
] as const;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function executeContextTool(args: Record<string, unknown>, repositoryRoot: string): string {
  const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
  if (!objective) throw new Error('objective is required and must be a non-empty string');
  const budget = clampInt(args.budget, 6000, 256, 200_000);
  const maxDepth = clampInt(args.max_depth, 2, 0, 5);
  const maxNodes = clampInt(args.max_nodes, 12, 1, 50);
  const artifact = compileContextForObjective(objective, repositoryRoot, { budget, maxDepth, maxNodes });
  return formatContextCommandOutput(artifact, args.format === 'json');
}

function executeTryTool(args: Record<string, unknown>, repositoryRoot: string): string {
  const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
  if (!objective) throw new Error('objective is required and must be a non-empty string');
  const depGraph = loadOrGenerateDependencyGraph(repositoryRoot);
  const curatedGraph = tryReadCuratedCodeGraph(repositoryRoot) ?? normalizeCuratedGraph(null);
  const primaryProfile = detectProjectProfile();
  const components = primaryProfile && getAvailableProfiles().includes(primaryProfile) ? [primaryProfile] : [];
  const rules = resolveExclusions(components);
  const report = buildTryReport(objective, depGraph, curatedGraph, { maxNodes: 12, maxDepth: 2, rules, includeGlobs: [] });
  return formatTryOutput(report, detectCtaState(repositoryRoot));
}

function executeQualityTool(args: Record<string, unknown>, repositoryRoot: string): string {
  const explicitFiles = Array.isArray(args.files)
    ? args.files.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : null;
  const files = explicitFiles ?? discoverTargetQualityFiles(repositoryRoot, Boolean(args.strict));
  const report = analyzeFilesQuality(repositoryRoot, files);
  return JSON.stringify(report, null, 2);
}

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, repositoryRoot: string) => string> = {
  forgeai_context: executeContextTool,
  forgeai_try: executeTryTool,
  forgeai_check_quality: executeQualityTool,
  forgeai_diagnostics: () => `${buildStatusSummary()}\n${buildDiffSummary()}`
};

function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function callMcpTool(params: Record<string, unknown> | undefined, repositoryRoot: string): Record<string, unknown> {
  const name = String(params?.name ?? '');
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `Error: unknown tool: ${name}` }], isError: true };
  }
  try {
    const text = handler(normalizeToolArguments(params?.arguments), repositoryRoot);
    return { content: [{ type: 'text', text }], isError: false };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${getErrorMessage(error)}` }], isError: true };
  }
}

function buildInitializeResult(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const requestedVersion = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
  return {
    protocolVersion: requestedVersion,
    capabilities: { tools: {} },
    serverInfo: { name: 'forgeai-agentic-init', version: getPackageVersion() }
  };
}

function isPlainRecord(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function handleMcpRequest(raw: unknown, repositoryRoot = root): Record<string, unknown> | null {
  if (!isPlainRecord(raw)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (raw.id === undefined) return null;
  const method = String(raw.method ?? '');
  if (method === 'initialize') return { jsonrpc: '2.0', id: raw.id, result: buildInitializeResult(raw.params) };
  if (method === 'ping') return { jsonrpc: '2.0', id: raw.id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id: raw.id, result: { tools: MCP_TOOLS } };
  if (method === 'tools/call') return { jsonrpc: '2.0', id: raw.id, result: callMcpTool(raw.params, repositoryRoot) };

  return { jsonrpc: '2.0', id: raw.id, error: { code: -32601, message: `Method not found: ${method}` } };
}

export function runMcp(): void {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    const response = handleMcpRequest(parsed, root);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
