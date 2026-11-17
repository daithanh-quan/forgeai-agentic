import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rawArgs, root } from './context.js';
import { loadOrGenerateDependencyGraph } from './dependency-graph.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph, resolveExclusionContext } from './context-pack.js';
import { compileContext, renderCompiledContextMarkdown } from './context-compiler.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { resolveExclusions } from './profile-exclusions.js';
import type { CompiledContextArtifact } from './types.js';
import { getErrorMessage } from './utils.js';

const ALLOWED_OPTIONS = new Set(['--objective', '--budget', '--max-depth', '--max-nodes', '--output']);

type ParsedContextArgs = {
  objective: string;
  json: boolean;
  copy: boolean;
  budget: number;
  maxDepth: number;
  maxNodes: number;
  output: string | undefined;
};

function parseIntegerOption(values: Map<string, string>, name: string, fallback: number, min: number, max: number): number {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function parseOptionToken(arg: string, index: number, argv: string[], values: Map<string, string>): number {
  const equal = arg.indexOf('=');
  const name = equal < 0 ? arg : arg.slice(0, equal);
  if (!ALLOWED_OPTIONS.has(name)) throw new Error(`unknown context option: ${name}`);
  const nextIndex = equal < 0 ? index + 1 : index;
  const value = equal < 0 ? argv[nextIndex] : arg.slice(equal + 1);
  if (!value?.trim() || value.startsWith('--')) throw new Error(`${name} requires a value`);
  if (values.has(name)) throw new Error(`${name} cannot be specified more than once`);
  values.set(name, value);
  return nextIndex;
}

function resolveFinalObjective(positional: string | undefined, values: Map<string, string>): string {
  if (positional !== undefined && values.has('--objective')) throw new Error('provide only one objective');
  const resolved = positional ?? values.get('--objective');
  if (!resolved?.trim()) {
    throw new Error('Usage: forgeai-init context "<objective>" [--budget 6000] [--json] [--copy] [--output <new-file>]');
  }
  return resolved;
}

const COPY_FLAGS = new Set(['--copy', '-c']);

function parseContextArgs(argv: string[]): ParsedContextArgs {
  const values = new Map<string, string>();
  let objective: string | undefined;
  let json = false;
  let copy = false;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (COPY_FLAGS.has(arg)) copy = true;
    else if (arg.startsWith('-')) index = parseOptionToken(arg, index, argv, values);
    else if (objective !== undefined) throw new Error('quote the objective as a single argument');
    else objective = arg;
  }
  return {
    objective: resolveFinalObjective(objective, values),
    json,
    copy,
    budget: parseIntegerOption(values, '--budget', 6000, 256, 200_000),
    maxDepth: parseIntegerOption(values, '--max-depth', 2, 0, 5),
    maxNodes: parseIntegerOption(values, '--max-nodes', 12, 1, 50),
    output: values.get('--output')
  };
}

function resolveContextPolicy(repositoryRoot: string) {
  if (fs.existsSync(path.join(repositoryRoot, '.ai/manifest.json'))) {
    return resolveExclusionContext(null);
  }
  const detected = detectProjectProfile();
  const profiles = detected && getAvailableProfiles().includes(detected) ? [detected] : [];
  return { profiles, rules: resolveExclusions(profiles), includeGlobs: [] };
}

export function compileContextForObjective(
  objective: string,
  repositoryRoot: string,
  options: { budget?: number; maxDepth?: number; maxNodes?: number } = {}
): CompiledContextArtifact {
  const graph = loadOrGenerateDependencyGraph(repositoryRoot);
  const policy = resolveContextPolicy(repositoryRoot);
  const curated = tryReadCuratedCodeGraph(repositoryRoot) ?? normalizeCuratedGraph(null);
  const artifact = compileContext(objective, curated, graph, repositoryRoot, {
    budget: options.budget ?? 6000,
    maxDepth: options.maxDepth ?? 2,
    maxNodes: options.maxNodes ?? 12,
    ...policy
  });
  if (!artifact.selection.files.length) {
    throw new Error('No matching source files. Include an existing file path or symbol name in the objective; selection uses keyword matches and dependencies, not semantic translation.');
  }
  if (!artifact.excerpts.length) throw new Error('No source excerpts fit the budget. Increase --budget or narrow the objective.');
  return artifact;
}

export function formatContextCommandOutput(artifact: CompiledContextArtifact, json: boolean): string {
  if (json) return `${JSON.stringify(artifact, null, 2)}\n`;
  return [
    '# Context for your coding agent',
    '',
    'Use the source excerpts below to investigate the objective. Follow the repository instructions. This is selected context, not proof that all required code is present. Request missing context before making unsupported assumptions.',
    '',
    `Selection: ${artifact.selection.files.length} files; ${artifact.excerpts.length} excerpts; ${artifact.omitted_candidates} candidates omitted.`,
    'The token budget estimates the JSON artifact using characters / 4; rendered Markdown and actual provider token counts may differ.',
    artifact.budget.exhausted ? 'Some context was omitted or reduced to signatures to fit the budget. Increase --budget if needed.' : '',
    '',
    renderCompiledContextMarkdown(artifact)
  ].join('\n');
}

export function copyToClipboard(text: string): void {
  const testTarget = process.env.FORGEAI_CLIPBOARD_FILE;
  if (testTarget) {
    fs.writeFileSync(testTarget, text, 'utf8');
    return;
  }
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']]
          ];
  for (const [cmd, cmdArgs] of candidates) {
    const res = spawnSync(cmd, cmdArgs, { input: text, encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'] });
    if (!res.error && res.status === 0) return;
  }
  throw new Error('could not copy to clipboard (no supported clipboard utility found)');
}

// Parse this small interface separately so typos cannot silently initialize a harness.
export function runContext(): void {
  try {
    const parsed = parseContextArgs(rawArgs);
    const artifact = compileContextForObjective(parsed.objective, root, {
      budget: parsed.budget,
      maxDepth: parsed.maxDepth,
      maxNodes: parsed.maxNodes
    });
    const output = formatContextCommandOutput(artifact, parsed.json);
    if (parsed.copy) {
      copyToClipboard(output);
      process.stderr.write(
        `Context copied to clipboard (${artifact.selection.files.length} files, ${artifact.excerpts.length} excerpts, ~${artifact.budget.estimated_tokens} estimated tokens)\n`
      );
    }
    if (parsed.output) {
      // Never overwrite source, existing artifacts, or symlink destinations.
      fs.writeFileSync(path.resolve(root, parsed.output), output, { flag: 'wx' });
      process.stderr.write(`Context written to ${parsed.output}\n`);
    } else if (!parsed.copy) {
      process.stdout.write(output);
    }
  } catch (error) {
    process.stderr.write(`Error: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
