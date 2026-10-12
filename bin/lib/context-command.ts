import fs from 'node:fs';
import path from 'node:path';
import { rawArgs, root } from './context.js';
import { generateDependencyGraph } from './dependency-graph.js';
import { normalizeCuratedGraph, tryReadCuratedCodeGraph, resolveExclusionContext } from './context-pack.js';
import { compileContext, renderCompiledContextMarkdown } from './context-compiler.js';
import { detectProjectProfile, getAvailableProfiles } from './profiles.js';
import { resolveExclusions } from './profile-exclusions.js';
import { getErrorMessage } from './utils.js';

// Parse this small interface separately so typos cannot silently initialize a harness.
export function runContext(): void {
  try {
    const values = new Map<string, string>();
    let objective: string | undefined;
    let json = false;
    const allowed = new Set(['--objective', '--budget', '--max-depth', '--max-nodes', '--output']);
    for (let index = 1; index < rawArgs.length; index++) {
      const arg = rawArgs[index];
      if (arg === '--json') { json = true; continue; }
      if (arg.startsWith('-')) {
        const equal = arg.indexOf('=');
        const name = equal < 0 ? arg : arg.slice(0, equal);
        if (!allowed.has(name)) throw new Error(`unknown context option: ${name}`);
        const value = equal < 0 ? rawArgs[++index] : arg.slice(equal + 1);
        if (!value?.trim() || value.startsWith('--')) throw new Error(`${name} requires a value`);
        if (values.has(name)) throw new Error(`${name} cannot be specified more than once`);
        values.set(name, value);
      } else {
        if (objective !== undefined) throw new Error('quote the objective as a single argument');
        objective = arg;
      }
    }
    if (objective !== undefined && values.has('--objective')) throw new Error('provide only one objective');
    objective = objective ?? values.get('--objective');
    if (!objective?.trim()) throw new Error('Usage: forgeai-init context "<objective>" [--budget 6000] [--json] [--output <new-file>]');
    const integer = (name: string, fallback: number, min: number, max: number): number => {
      const raw = values.get(name);
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}`);
      }
      return value;
    };
    const budget = integer('--budget', 6000, 256, 200_000);
    const maxDepth = integer('--max-depth', 2, 0, 5);
    const maxNodes = integer('--max-nodes', 12, 1, 50);
    const graph = generateDependencyGraph(root);
    let policy = resolveExclusionContext(null);
    if (!fs.existsSync(path.join(root, '.ai/manifest.json'))) {
      const detected = detectProjectProfile();
      const profiles = detected && getAvailableProfiles().includes(detected) ? [detected] : [];
      policy = { profiles, rules: resolveExclusions(profiles), includeGlobs: [] };
    }
    const artifact = compileContext(objective, tryReadCuratedCodeGraph(root) ?? normalizeCuratedGraph(null), graph, root,
      { budget, maxDepth, maxNodes, ...policy });
    if (!artifact.selection.files.length) {
      throw new Error('No matching source files. Include an existing file path or symbol name in the objective; selection uses keyword matches and dependencies, not semantic translation.');
    }
    if (!artifact.excerpts.length) throw new Error('No source excerpts fit the budget. Increase --budget or narrow the objective.');
    const output = json ? `${JSON.stringify(artifact, null, 2)}\n` : [
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
    const target = values.get('--output');
    if (target) {
      // Never overwrite source, existing artifacts, or symlink destinations.
      fs.writeFileSync(path.resolve(root, target), output, { flag: 'wx' });
      process.stderr.write(`Context written to ${target}\n`);
    } else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`Error: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
