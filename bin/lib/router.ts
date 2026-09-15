import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ArtifactValidationResult, CompiledContextArtifact, AdapterConfig } from './types.js';
import { computeArtifactEstimate } from './context-compiler.js';
import { checkDependencyGraphHealth, readDependencyGraph } from './dependency-graph.js';
import { formatStatus, getErrorMessage, isValidTaskId, isValidExperimentId } from './utils.js';
import { root, getArgValue, stream as streamFlag } from './context.js';
import { ADAPTERS_RELATIVE } from './model-routing.js';
import { loadApiAdapters, callApiAdapter, API_ADAPTERS_RELATIVE } from './api-adapter.js';

const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;
const MAX_DEPTH = 5;
const MAX_NODES = 50;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSortedUniqueNonEmptyStrings(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) return false;
  return value.every((entry, index) => index === 0 || value[index - 1].localeCompare(entry) < 0);
}

function isCanonicalRepoRelative(value: string): boolean {
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:\//.test(value)) return false;
  const segments = value.split('/');
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isSafeRepoGlob(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:\//.test(value)) return false;
  return value.split('/').every((segment, index, all) =>
    (segment.length > 0 || index === all.length - 1) && segment !== '.' && segment !== '..'
  );
}

// Pure structural validator (no fingerprint/graph freshness). Exported so
// `--evaluate` can screen candidate artifacts without rejecting ones compiled at
// an earlier revision.
export function checkArtifactStructure(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'artifact is not an object';
  const a = raw as Record<string, unknown>;
  if (a.kind !== 'forgeai_compiled_context') return `kind must be 'forgeai_compiled_context', got '${String(a.kind)}'`;
  if (a.schema_version !== 1) return `schema_version must be 1, got ${String(a.schema_version)}`;
  if (typeof a.objective !== 'string' || a.objective.length === 0) return 'objective must be a non-empty string';
  if (a.task_id !== null && a.task_id !== undefined && (typeof a.task_id !== 'string' || !isValidTaskId(a.task_id))) {
    return 'task_id must be null or a valid TASK-YYYYMMDD-slug string';
  }
  if (a.artifact_role !== undefined && a.artifact_role !== 'primary' && a.artifact_role !== 'expansion') {
    return "artifact_role must be 'primary' or 'expansion'";
  }
  if (a.mode !== undefined && a.mode !== 'baseline' && a.mode !== 'compact') {
    return "mode must be 'baseline' or 'compact'";
  }
  if (a.experiment_id !== null && a.experiment_id !== undefined && (typeof a.experiment_id !== 'string' || !isValidExperimentId(a.experiment_id))) {
    return 'experiment_id must be null or a valid EXP-YYYYMMDD-slug string';
  }
  if (a.parent_artifact !== null && a.parent_artifact !== undefined && typeof a.parent_artifact !== 'string') {
    return 'parent_artifact must be null or a string';
  }
  const repo = a.repository as Record<string, unknown> | undefined;
  if (!repo || typeof repo.fingerprint !== 'string' || repo.fingerprint.length === 0) return 'repository.fingerprint must be a non-empty string';
  if (!repo || !('revision' in repo) || (repo.revision !== null && typeof repo.revision !== 'string')) return 'repository.revision must be string or null';
  const budget = a.budget as Record<string, unknown> | undefined;
  if (!budget) return 'budget is required';
  if (!isPositiveInteger(budget.limit_tokens)) return 'budget.limit_tokens must be a positive integer';
  if (budget.limit_tokens < MIN_BUDGET || (budget.limit_tokens as number) > MAX_BUDGET) return `budget.limit_tokens must be between ${MIN_BUDGET} and ${MAX_BUDGET}`;
  if (!isNonNegativeInteger(budget.estimated_tokens)) return 'budget.estimated_tokens must be a non-negative integer';
  if (budget.estimator !== 'characters_divided_by_4') return "budget.estimator must be 'characters_divided_by_4'";
  if (typeof budget.exhausted !== 'boolean') return 'budget.exhausted must be a boolean';
  const sel = a.selection as Record<string, unknown> | undefined;
  if (!sel) return 'selection is required';
  if (!isNonNegativeInteger(sel.max_depth) || (sel.max_depth as number) > MAX_DEPTH) return `selection.max_depth must be an integer 0–${MAX_DEPTH}`;
  if (!isPositiveInteger(sel.max_nodes) || (sel.max_nodes as number) > MAX_NODES) return `selection.max_nodes must be an integer 1–${MAX_NODES}`;
  if (!Array.isArray(sel.files)) return 'selection.files must be an array';
  for (const file of sel.files as unknown[]) {
    if (typeof file !== 'object' || file === null) return 'selection.files items must be objects';
    const f = file as Record<string, unknown>;
    if (typeof f.path !== 'string' || f.path.length === 0) return 'selection.files[].path must be a non-empty string';
    if (!isNonNegativeInteger(f.depth)) return 'selection.files[].depth must be a non-negative integer';
    if (typeof f.reason !== 'string' || f.reason.length === 0) return 'selection.files[].reason must be a non-empty string';
    if (typeof f.graph_path !== 'string') return 'selection.files[].graph_path must be a string';
  }
  if (!Array.isArray(a.excerpts)) return 'excerpts must be an array';
  const validExcerptKinds = new Set(['import', 'function', 'class', 'interface', 'type', 'enum', 'variable', 'test', 'file']);
  const selectionPaths = new Set((sel.files as Array<{ path: string }>).map((f) => f.path));
  for (const exc of a.excerpts as unknown[]) {
    if (typeof exc !== 'object' || exc === null) return 'excerpts items must be objects';
    const e = exc as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path.length === 0) return 'excerpts[].path must be a non-empty string';
    if (!validExcerptKinds.has(e.kind as string)) return `excerpts[].kind must be one of: ${Array.from(validExcerptKinds).join(', ')}`;
    if (typeof e.name !== 'string') return 'excerpts[].name must be a string';
    if (typeof e.reason !== 'string') return 'excerpts[].reason must be a string';
    if (!isPositiveInteger(e.source_start_line)) return 'excerpts[].source_start_line must be a positive integer';
    if (!isPositiveInteger(e.source_end_line) || (e.source_end_line as number) < (e.source_start_line as number)) return 'excerpts[].source_end_line must be a positive integer >= source_start_line';
    if (e.mode !== 'full' && e.mode !== 'signature') return "excerpts[].mode must be 'full' or 'signature'";
    if (typeof e.content !== 'string') return 'excerpts[].content must be a string';
    if (!selectionPaths.has(e.path as string)) return `excerpts[].path '${String(e.path)}' does not appear in selection.files`;
  }
  if (!Array.isArray(a.rules)) return 'rules must be an array';
  for (const rule of a.rules as unknown[]) {
    if (typeof rule !== 'object' || rule === null) return 'rules items must be objects';
    const r = rule as Record<string, unknown>;
    if (r.path !== '.ai/RULES.md') return "rules[].path must be '.ai/RULES.md'";
    if (typeof r.heading !== 'string') return 'rules[].heading must be a string';
    if (typeof r.reason !== 'string') return 'rules[].reason must be a string';
    if (!isPositiveInteger(r.source_start_line)) return 'rules[].source_start_line must be a positive integer';
    if (!isPositiveInteger(r.source_end_line) || (r.source_end_line as number) < (r.source_start_line as number)) return 'rules[].source_end_line must be >= source_start_line';
    if (typeof r.content !== 'string') return 'rules[].content must be a string';
  }
  if (!Array.isArray(a.contracts) || (a.contracts as unknown[]).some((c) => typeof c !== 'string')) return 'contracts must be an array of strings';
  if (!Array.isArray(a.entrypoints) || (a.entrypoints as unknown[]).some((e) => typeof e !== 'string')) return 'entrypoints must be an array of strings';
  if (!isNonNegativeInteger(a.omitted_candidates)) return 'omitted_candidates must be a non-negative integer';
  if (typeof a.diagnostics !== 'object' || a.diagnostics === null) return 'diagnostics must be an object';
  // context_exclusions and omitted_context are additive (3.11.0+). Accept absence
  // on legacy artifacts; validate the full shape when present.
  if ((a.context_exclusions === undefined) !== (a.omitted_context === undefined)) {
    return 'context_exclusions and omitted_context must either both be present or both be absent';
  }
  const exclusionRuleKeys = new Set<string>();
  if (a.context_exclusions !== undefined) {
    const ce = a.context_exclusions as Record<string, unknown>;
    if (typeof ce !== 'object' || ce === null || Array.isArray(ce)) return 'context_exclusions must be an object';
    if (!isSortedUniqueNonEmptyStrings(ce.profiles)) return 'context_exclusions.profiles must be an array of strings that is sorted, unique, and non-empty';
    if (!isSortedUniqueNonEmptyStrings(ce.include_globs)) return 'context_exclusions.include_globs must be an array of strings that is sorted, unique, and non-empty';
    if ((ce.include_globs as string[]).some((glob) => !isSafeRepoGlob(glob))) return 'context_exclusions.include_globs must contain safe repo-relative POSIX globs';
    if (!Array.isArray(ce.rules)) return 'context_exclusions.rules must be an array';
    let previousPattern = '';
    const policyProfiles = new Set(ce.profiles as string[]);
    for (const rule of ce.rules as unknown[]) {
      if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return 'context_exclusions.rules items must be objects';
      const r = rule as Record<string, unknown>;
      if (typeof r.pattern !== 'string' || r.pattern.length === 0) return 'context_exclusions.rules[].pattern must be a non-empty string';
      if (!isSafeRepoGlob(r.pattern)) return 'context_exclusions.rules[].pattern must be a safe repo-relative POSIX pattern';
      if (typeof r.reason !== 'string' || r.reason.length === 0) return 'context_exclusions.rules[].reason must be a non-empty string';
      if (!isSortedUniqueNonEmptyStrings(r.profiles)) return 'context_exclusions.rules[].profiles must be an array of strings that is sorted, unique, and non-empty';
      if ((r.profiles as string[]).some((profile) => !policyProfiles.has(profile))) return 'context_exclusions.rules[].profiles must be included in context_exclusions.profiles';
      if (previousPattern && previousPattern.localeCompare(r.pattern) >= 0) return 'context_exclusions.rules must be sorted and unique by pattern';
      previousPattern = r.pattern;
      exclusionRuleKeys.add(JSON.stringify([r.pattern, r.reason, r.profiles]));
    }
  }
  if (a.omitted_context !== undefined) {
    if (!Array.isArray(a.omitted_context)) return 'omitted_context must be an array';
    let prevPath = '';
    for (const om of a.omitted_context as unknown[]) {
      if (typeof om !== 'object' || om === null || Array.isArray(om)) return 'omitted_context items must be objects';
      const o = om as Record<string, unknown>;
      if (typeof o.path !== 'string' || !isCanonicalRepoRelative(o.path)) return 'omitted_context[].path must be a canonical repo-relative POSIX path';
      if (typeof o.pattern !== 'string' || o.pattern.length === 0) return 'omitted_context[].pattern must be a non-empty string';
      if (typeof o.reason !== 'string' || o.reason.length === 0) return 'omitted_context[].reason must be a non-empty string';
      if (!isSortedUniqueNonEmptyStrings(o.profiles)) return 'omitted_context[].profiles must be an array of strings that is sorted, unique, and non-empty';
      if (!exclusionRuleKeys.has(JSON.stringify([o.pattern, o.reason, o.profiles]))) return 'omitted_context[] must reference a rule in context_exclusions.rules';
      if (prevPath && prevPath.localeCompare(o.path as string) >= 0) return 'omitted_context must be sorted and unique by path';
      prevPath = o.path as string;
      if (selectionPaths.has(o.path as string)) return `omitted_context[].path '${String(o.path)}' also appears in selection.files`;
    }
  }
  return null;
}

export function validateArtifact(artifactPath: string, repositoryRoot: string): ArtifactValidationResult {
  // Parse
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return { status: 'invalid', detail: `cannot parse artifact: ${getErrorMessage(error)}` };
  }

  // Structural check
  const structureError = checkArtifactStructure(raw);
  if (structureError) return { status: 'invalid', detail: structureError };
  const artifact = raw as CompiledContextArtifact;

  // Dependency graph health (stage 1)
  const depGraph = readDependencyGraph(repositoryRoot);
  const health = checkDependencyGraphHealth(repositoryRoot, depGraph);
  if (health.status !== 'ok') return { status: 'invalid', detail: `dependency graph is ${health.status}: ${health.detail}` };

  // Fingerprint comparison (stage 2)
  if (artifact.repository.fingerprint !== depGraph!.repository.fingerprint) {
    return { status: 'stale', detail: 'artifact fingerprint does not match dependency graph; run --compile-context again' };
  }

  // Selection path membership
  const depPaths = new Set(depGraph!.nodes.map((n) => n.path));
  for (const file of artifact.selection.files) {
    if (!depPaths.has(file.path)) return { status: 'invalid', detail: `selection.files path '${file.path}' not in dependency graph` };
  }
  for (const exc of artifact.excerpts) {
    if (!depPaths.has(exc.path)) return { status: 'invalid', detail: `excerpts path '${exc.path}' not in dependency graph` };
  }
  for (const omitted of artifact.omitted_context ?? []) {
    if (!depPaths.has(omitted.path)) return { status: 'invalid', detail: `omitted_context path '${omitted.path}' not in dependency graph` };
  }

  // Token estimate check (pure)
  const declared = artifact.budget.estimated_tokens;
  const recomputed = computeArtifactEstimate(artifact);
  if (declared !== recomputed) return { status: 'invalid', detail: `declared estimated_tokens ${declared} does not match recomputed ${recomputed}` };

  // Budget check
  if (artifact.budget.estimated_tokens > artifact.budget.limit_tokens) {
    return { status: 'invalid', detail: `estimated_tokens ${artifact.budget.estimated_tokens} exceeds limit_tokens ${artifact.budget.limit_tokens}` };
  }

  // Normalize the new fields only on return, so the estimate above was computed
  // against the raw (possibly pre-3.9.0) shape.
  return {
    status: 'ok',
    artifact: {
      ...artifact,
      task_id: artifact.task_id ?? null,
      artifact_role: artifact.artifact_role ?? 'primary',
      mode: artifact.mode ?? 'compact',
      experiment_id: artifact.experiment_id ?? null,
      parent_artifact: artifact.parent_artifact ?? null,
      context_exclusions: artifact.context_exclusions ?? { profiles: [], include_globs: [], rules: [] },
      omitted_context: artifact.omitted_context ?? [],
    }
  };
}

export function runValidateArtifact(): void {
  const artifactArg = getArgValue('--artifact');
  if (!artifactArg) {
    process.stderr.write('Usage: forgeai-init --validate-artifact --artifact <path>\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const result = validateArtifact(artifactPath, root);
  if (result.status !== 'ok') {
    process.stderr.write(`Error: ${result.detail}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${formatStatus('ok', `artifact is valid (estimated ${result.artifact.budget.estimated_tokens}/${result.artifact.budget.limit_tokens} tokens)`)}\n`);
}

function sanitizeForJournal(value: string): string {
  return value.replace(/[\x00-\x1F]/g, ' ');
}

export function resolvePlaceholders(
  args: string[],
  ctx: { model?: string; assignment: string; tokenBudget: number }
): { resolved: string[]; unresolved: string[] } {
  const map: Record<string, string | undefined> = {
    '{model}': ctx.model,
    '{assignment}': ctx.assignment,
    '{token_budget}': String(ctx.tokenBudget)
  };
  const unresolved: string[] = [];
  const resolved = args.map((arg) =>
    arg.replace(/\{[^}]+\}/g, (placeholder) => {
      if (placeholder in map) {
        if (map[placeholder] === undefined) {
          unresolved.push(placeholder);
          return placeholder;
        }
        return map[placeholder]!;
      }
      unresolved.push(placeholder);
      return placeholder;
    })
  );
  return { resolved, unresolved };
}

function appendJournal(entry: string, repositoryRoot: string): void {
  const journalPath = path.join(repositoryRoot, '.ai', 'state', 'context-routes.md');
  try {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.appendFileSync(journalPath, entry);
  } catch (error) {
    process.stderr.write(`Error: failed to write routing journal: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

function buildJournalEntry(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterLabel: string,
  model: string | null,
  status: string
): string {
  const timestamp = new Date().toISOString();
  const lines = [
    `## ${sanitizeForJournal(timestamp)} — ${sanitizeForJournal(artifactPath)}`,
    '',
    `- Objective: ${sanitizeForJournal(artifact.objective)}`,
    `- Repository fingerprint: ${sanitizeForJournal(artifact.repository.fingerprint)}`,
    `- Estimated tokens: ${artifact.budget.estimated_tokens}/${artifact.budget.limit_tokens}`,
    `- Files included: ${artifact.selection.files.length}`,
    `- Omitted candidates: ${artifact.omitted_candidates}`,
    `- Adapter: ${sanitizeForJournal(adapterLabel)}`,
    ...(model ? [`- Model: ${sanitizeForJournal(model)}`] : []),
    `- Status: ${sanitizeForJournal(status)}`,
    '',
    ''
  ];
  return lines.join('\n');
}

function routeCliAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string,
  model: string | null,
  repositoryRoot: string,
  json: string,
  quiet = false
): void {
  const configPath = path.join(repositoryRoot, ADAPTERS_RELATIVE);
  if (!fs.existsSync(configPath)) {
    process.stderr.write(`Error: ${ADAPTERS_RELATIVE} not found. Run forgeai-init first.\n`);
    process.exitCode = 1;
    return;
  }
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Error: invalid ${ADAPTERS_RELATIVE}: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    process.stderr.write(`Error: invalid ${ADAPTERS_RELATIVE}: must be a JSON object.\n`);
    process.exitCode = 1;
    return;
  }
  const config = rawConfig as AdapterConfig;
  const cliAdapters = config.adapters;
  const adapter = cliAdapters !== undefined && Object.hasOwn(cliAdapters, adapterName) ? cliAdapters[adapterName] : undefined;
  if (!adapter) {
    process.stderr.write(`Error: adapter '${adapterName}' not found in ${ADAPTERS_RELATIVE}.\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof adapter.command !== 'string' || adapter.command.length === 0) {
    process.stderr.write(`Error: adapter '${adapterName}' has no command configured.\n`);
    process.exitCode = 1;
    return;
  }
  if (
    adapter.healthcheck !== undefined &&
    (typeof adapter.healthcheck !== 'object' || adapter.healthcheck === null || Array.isArray(adapter.healthcheck))
  ) {
    process.stderr.write(`Error: adapter '${adapterName}' healthcheck must be a plain object.\n`);
    process.exitCode = 1;
    return;
  }
  if (adapter.input === 'argv') {
    process.stderr.write('Error: argv adapters cannot deliver compiled context in Phase 11.\nUse a stdin adapter (claude, codex, agy) or pipe to stdout with --adapter omitted.\n');
    process.exitCode = 1;
    return;
  }
  if (adapter.input !== 'stdin') {
    process.stderr.write(`Error: adapter input mode '${String(adapter.input)}' is not supported.\n`);
    process.exitCode = 1;
    return;
  }
  const adapterArgs = adapter.args ?? [];
  if (!Array.isArray(adapterArgs) || adapterArgs.some((a) => typeof a !== 'string')) {
    process.stderr.write(`Error: adapter '${adapterName}' args must be an array of strings.\n`);
    process.exitCode = 1;
    return;
  }
  if (adapter.healthcheck) {
    const hcArgs = adapter.healthcheck.args;
    if (hcArgs !== undefined && (!Array.isArray(hcArgs) || hcArgs.some((a) => typeof a !== 'string'))) {
      process.stderr.write(`Error: adapter '${adapterName}' healthcheck.args must be an array of strings.\n`);
      process.exitCode = 1;
      return;
    }
    const hcTimeout = adapter.healthcheck.timeout_ms;
    if (hcTimeout !== undefined && (!Number.isInteger(hcTimeout) || hcTimeout <= 0)) {
      process.stderr.write(`Error: adapter '${adapterName}' healthcheck.timeout_ms must be a positive integer.\n`);
      process.exitCode = 1;
      return;
    }
    const hcResult = spawnSync(adapter.command, hcArgs ?? [], { timeout: hcTimeout ?? undefined, encoding: 'utf8' });
    if (hcResult.error || hcResult.status !== 0) {
      process.stderr.write(`Error: healthcheck for '${adapterName}' failed.\n`);
      process.exitCode = 1;
      return;
    }
  }
  const { resolved, unresolved } = resolvePlaceholders(adapterArgs as string[], {
    model: model ?? undefined,
    assignment: artifact.objective,
    tokenBudget: artifact.budget.limit_tokens
  });
  if (unresolved.length > 0) {
    process.stderr.write(`Error: unresolved placeholders in adapter args: ${unresolved.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const result = spawnSync(adapter.command, resolved, {
    cwd: repositoryRoot,
    input: json,
    stdio: ['pipe', quiet ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8'
  });
  const adapterLabel = `${adapterName} (stdin)`;
  if (result.error) {
    process.stderr.write(`Error: failed to spawn adapter '${adapterName}': ${result.error.message}\n`);
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'failed (spawn error)'), repositoryRoot);
    process.exitCode = 1;
    return;
  }
  if (result.signal) {
    process.stderr.write(`Error: adapter '${adapterName}' killed by signal ${result.signal}.\n`);
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, `failed (signal ${result.signal})`), repositoryRoot);
    process.exitCode = 1;
    return;
  }
  const exitCode = result.status ?? 0;
  const status = exitCode === 0 ? 'ok' : `failed (exit ${exitCode})`;
  appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, status), repositoryRoot);
  if (exitCode !== 0) {
    process.stderr.write(`Error: adapter '${adapterName}' exited with code ${exitCode}.\n`);
    process.exitCode = 1;
  }
}

export async function routeToAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string | null,
  model: string | null,
  repositoryRoot: string,
  stream = false,
  quiet = false
): Promise<void> {
  const json = `${JSON.stringify(artifact, null, 2)}\n`;

  if (!adapterName) {
    process.stdout.write(json);
    appendJournal(buildJournalEntry(artifact, artifactPath, 'stdout', model, 'ok'), repositoryRoot);
    return;
  }

  // Check API adapters first
  const loaded = loadApiAdapters(repositoryRoot);

  if (loaded !== null && !loaded.ok) {
    // Config file exists but is invalid — fail fast, do not silently fall through to CLI
    process.stderr.write(`Error: invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}\n`);
    process.exitCode = 1;
    return;
  }

  const adapterMap = loaded?.ok ? loaded.config.adapters : undefined;
  const apiEntry = adapterMap !== undefined && Object.hasOwn(adapterMap, adapterName) ? adapterMap[adapterName] : undefined;

  if (apiEntry) {
    const effectiveModel = model ?? apiEntry.model;
    const { result } = await callApiAdapter(adapterName, artifact, artifactPath, repositoryRoot, model, {
      stream,
      onDelta: (t) => { if (!quiet) process.stdout.write(t); },
    });
    const status = result.ok ? 'ok' : `failed (${result.error_kind ?? 'error'})`;
    appendJournal(buildJournalEntry(artifact, artifactPath, `${adapterName} (api${result.streamed ? ', stream' : ''})`, effectiveModel, status), repositoryRoot);

    if (result.ok) {
      // Buffered: write the full text once. Streamed: bytes already went to stdout.
      if (!quiet && !result.streamed && result.text) process.stdout.write(result.text);
      return;
    }

    if (result.streamed) {
      // Bytes already written to stdout — cannot retry or fall back.
      process.stderr.write(`Error: API adapter '${adapterName}' failed mid-stream: ${result.error ?? 'unknown'}\n`);
      process.exitCode = 1;
      return;
    }

    if (result.error_kind === 'auth') {
      // Auth errors never fall back — fail immediately
      process.stderr.write(`Error: API adapter '${adapterName}' authentication failed: ${result.error ?? ''}\n`);
      process.exitCode = 1;
      return;
    }

    if (result.error_kind === 'quota') {
      const cliFallback = apiEntry.fallback_adapter ?? adapterName;
      process.stderr.write(`${formatStatus('warn', `API adapter '${adapterName}' hit quota; falling back to CLI adapter '${cliFallback}'`)}\n`);
      routeCliAdapter(artifact, artifactPath, cliFallback, effectiveModel, repositoryRoot, json, quiet);
      return;
    }

    // Other errors (network, provider, invalid_response) — fail
    process.stderr.write(`Error: API adapter '${adapterName}' failed: ${result.error ?? 'unknown'}\n`);
    process.exitCode = 1;
    return;
  }

  // No API adapter by this name — fall through to CLI
  if (stream) process.stderr.write(`${formatStatus('warn', `--stream has no effect on CLI adapter '${adapterName}' (it already streams via stdio)`)}\n`);
  routeCliAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, json, quiet);
}

export async function runRoute(): Promise<void> {
  const artifactArg = getArgValue('--artifact');
  if (!artifactArg) {
    process.stderr.write('Usage: forgeai-init --route --artifact <path> [--adapter <name>] [--model <id>]\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const result = validateArtifact(artifactPath, root);
  if (result.status !== 'ok') {
    process.stderr.write(`Error: ${result.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const adapterName = getArgValue('--adapter');
  const model = getArgValue('--model');
  if (model && !adapterName) {
    process.stderr.write(`${formatStatus('warn', '--model is ignored when --adapter is not specified')}\n`);
  }
  if (streamFlag && !adapterName) {
    process.stderr.write(`${formatStatus('warn', '--stream is ignored when --adapter is not specified')}\n`);
  }
  await routeToAdapter(result.artifact, artifactPath, adapterName, model, root, streamFlag);
}
