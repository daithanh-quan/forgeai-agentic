import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  Adapter,
  AdapterConfig,
  AgentResponse,
  ApiAdapterEntry,
  ArtifactValidationResult,
  CompiledContextArtifact
} from './types.js';
import { computeArtifactEstimate, renderAgentAssignment } from './context-compiler.js';
import { checkDependencyGraphHealth, readDependencyGraph } from './dependency-graph.js';
import { formatStatus, getErrorMessage, isValidTaskId, isValidExperimentId } from './utils.js';
import { root, getArgValue, stream as streamFlag, codeMode as codeModeFlag } from './context.js';
import { ADAPTERS_RELATIVE } from './model-routing.js';
import { loadApiAdapters, callApiAdapter, API_ADAPTERS_RELATIVE } from './api-adapter.js';

const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;
const MAX_DEPTH = 5;
const MAX_NODES = 50;
const VALID_EXCERPT_KINDS = new Set([
  'import', 'function', 'class', 'interface', 'type', 'enum', 'variable', 'test', 'file'
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSortedUniqueNonEmptyStrings(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(isNonEmptyString)) return false;
  return value.every((entry, idx) => idx === 0 || value[idx - 1].localeCompare(entry) < 0);
}

function isCanonicalRepoRelative(value: string): boolean {
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:\//.test(value)) return false;
  const segments = value.split('/');
  return segments.length > 0 && segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

function isSafeRepoGlob(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:\//.test(value)) return false;
  return value.split('/').every((s, idx, all) => (s.length > 0 || idx === all.length - 1) && s !== '.' && s !== '..');
}

function checkArtifactHeader(a: Record<string, unknown>): string | null {
  if (a.kind !== 'forgeai_compiled_context') {
    return `kind must be 'forgeai_compiled_context', got '${String(a.kind)}'`;
  }
  if (a.schema_version !== 1) return `schema_version must be 1, got ${String(a.schema_version)}`;
  if (!isNonEmptyString(a.objective)) return 'objective must be a non-empty string';
  return null;
}

function checkArtifactIds(a: Record<string, unknown>): string | null {
  if (a.task_id != null && (typeof a.task_id !== 'string' || !isValidTaskId(a.task_id))) {
    return 'task_id must be null or a valid TASK-YYYYMMDD-slug string';
  }
  if (a.experiment_id != null && (typeof a.experiment_id !== 'string' || !isValidExperimentId(a.experiment_id))) {
    return 'experiment_id must be null or a valid EXP-YYYYMMDD-slug string';
  }
  if (a.parent_artifact != null && typeof a.parent_artifact !== 'string') {
    return 'parent_artifact must be null or a string';
  }
  return null;
}

function checkArtifactOptionalMetadata(a: Record<string, unknown>): string | null {
  const idErr = checkArtifactIds(a);
  if (idErr) return idErr;
  if (a.artifact_role !== undefined && a.artifact_role !== 'primary' && a.artifact_role !== 'expansion') {
    return "artifact_role must be 'primary' or 'expansion'";
  }
  if (a.mode !== undefined && a.mode !== 'baseline' && a.mode !== 'compact') {
    return "mode must be 'baseline' or 'compact'";
  }
  return null;
}

function checkArtifactRepoBlock(a: Record<string, unknown>): string | null {
  const repo = a.repository as Record<string, unknown> | undefined;
  if (!repo || !isNonEmptyString(repo.fingerprint)) return 'repository.fingerprint must be a non-empty string';
  const validRev = 'revision' in repo && (repo.revision === null || typeof repo.revision === 'string');
  return validRev ? null : 'repository.revision must be string or null';
}

function checkArtifactBudgetBlock(a: Record<string, unknown>): string | null {
  const budget = a.budget as Record<string, unknown> | undefined;
  if (!budget) return 'budget is required';
  if (!isPositiveInteger(budget.limit_tokens)) return 'budget.limit_tokens must be a positive integer';
  if (budget.limit_tokens < MIN_BUDGET || budget.limit_tokens > MAX_BUDGET) {
    return `budget.limit_tokens must be between ${MIN_BUDGET} and ${MAX_BUDGET}`;
  }
  if (!isNonNegativeInteger(budget.estimated_tokens)) return 'budget.estimated_tokens must be a non-negative integer';
  if (budget.estimator !== 'characters_divided_by_4') return "budget.estimator must be 'characters_divided_by_4'";
  return typeof budget.exhausted === 'boolean' ? null : 'budget.exhausted must be a boolean';
}

function checkSingleSelectedFile(file: unknown): string | null {
  if (typeof file !== 'object' || file === null) return 'selection.files items must be objects';
  const f = file as Record<string, unknown>;
  if (!isNonEmptyString(f.path)) return 'selection.files[].path must be a non-empty string';
  if (!isNonNegativeInteger(f.depth)) return 'selection.files[].depth must be a non-negative integer';
  if (!isNonEmptyString(f.reason)) return 'selection.files[].reason must be a non-empty string';
  return typeof f.graph_path === 'string' ? null : 'selection.files[].graph_path must be a string';
}

function checkArtifactSelectionBlock(a: Record<string, unknown>): string | null {
  const sel = a.selection as Record<string, unknown> | undefined;
  if (!sel) return 'selection is required';
  if (!isNonNegativeInteger(sel.max_depth) || sel.max_depth > MAX_DEPTH) {
    return `selection.max_depth must be an integer 0–${MAX_DEPTH}`;
  }
  if (!isPositiveInteger(sel.max_nodes) || sel.max_nodes > MAX_NODES) {
    return `selection.max_nodes must be an integer 1–${MAX_NODES}`;
  }
  if (!Array.isArray(sel.files)) return 'selection.files must be an array';
  for (const file of sel.files) {
    const err = checkSingleSelectedFile(file);
    if (err) return err;
  }
  return null;
}

function checkLineSpan(start: unknown, end: unknown, prefix: string): string | null {
  if (!isPositiveInteger(start)) return `${prefix}.source_start_line must be a positive integer`;
  if (!isPositiveInteger(end) || end < start) {
    return `${prefix}.source_end_line must be a positive integer >= source_start_line`;
  }
  return null;
}

function checkExcerptIdentityFields(e: Record<string, unknown>): string | null {
  if (!isNonEmptyString(e.path)) return 'excerpts[].path must be a non-empty string';
  if (!VALID_EXCERPT_KINDS.has(String(e.kind))) {
    return `excerpts[].kind must be one of: ${Array.from(VALID_EXCERPT_KINDS).join(', ')}`;
  }
  if (typeof e.name !== 'string') return 'excerpts[].name must be a string';
  if (typeof e.reason !== 'string') return 'excerpts[].reason must be a string';
  return null;
}

function checkSingleExcerpt(exc: unknown, selectionPaths: Set<string>): string | null {
  if (typeof exc !== 'object' || exc === null) return 'excerpts items must be objects';
  const e = exc as Record<string, unknown>;
  const idErr = checkExcerptIdentityFields(e) ?? checkLineSpan(e.source_start_line, e.source_end_line, 'excerpts[]');
  if (idErr) return idErr;
  if (e.mode !== 'full' && e.mode !== 'signature') return "excerpts[].mode must be 'full' or 'signature'";
  if (typeof e.content !== 'string') return 'excerpts[].content must be a string';
  return selectionPaths.has(e.path as string) ? null : `excerpts[].path '${String(e.path)}' does not appear in selection.files`;
}

function checkRuleTextFields(r: Record<string, unknown>): string | null {
  if (r.path !== '.ai/RULES.md' && r.path !== '.ai/MEMORY.md') {
    return "rules[].path must be '.ai/RULES.md' or '.ai/MEMORY.md'";
  }
  if (typeof r.heading !== 'string') return 'rules[].heading must be a string';
  if (typeof r.reason !== 'string') return 'rules[].reason must be a string';
  return typeof r.content === 'string' ? null : 'rules[].content must be a string';
}

function checkSingleRule(rule: unknown): string | null {
  if (typeof rule !== 'object' || rule === null) return 'rules items must be objects';
  const r = rule as Record<string, unknown>;
  const textErr = checkRuleTextFields(r);
  if (textErr) return textErr;
  if (!isPositiveInteger(r.source_start_line)) return 'rules[].source_start_line must be a positive integer';
  if (!isPositiveInteger(r.source_end_line) || r.source_end_line < r.source_start_line) {
    return 'rules[].source_end_line must be >= source_start_line';
  }
  return null;
}

function checkExcerptsAndRulesList(a: Record<string, unknown>, selectionPaths: Set<string>): string | null {
  if (!Array.isArray(a.excerpts)) return 'excerpts must be an array';
  for (const exc of a.excerpts) {
    const err = checkSingleExcerpt(exc, selectionPaths);
    if (err) return err;
  }
  if (!Array.isArray(a.rules)) return 'rules must be an array';
  for (const rule of a.rules) {
    const err = checkSingleRule(rule);
    if (err) return err;
  }
  return null;
}

function checkArtifactCollections(a: Record<string, unknown>, selectionPaths: Set<string>): string | null {
  const listErr = checkExcerptsAndRulesList(a, selectionPaths);
  if (listErr) return listErr;
  if (!Array.isArray(a.contracts) || a.contracts.some((c) => typeof c !== 'string')) {
    return 'contracts must be an array of strings';
  }
  if (!Array.isArray(a.entrypoints) || a.entrypoints.some((e) => typeof e !== 'string')) {
    return 'entrypoints must be an array of strings';
  }
  if (!isNonNegativeInteger(a.omitted_candidates)) return 'omitted_candidates must be a non-negative integer';
  return typeof a.diagnostics === 'object' && a.diagnostics !== null ? null : 'diagnostics must be an object';
}

function checkExclusionTupleFields(item: Record<string, unknown>, prefix: string): string | null {
  if (!isNonEmptyString(item.pattern)) return `${prefix}.pattern must be a non-empty string`;
  if (!isNonEmptyString(item.reason)) return `${prefix}.reason must be a non-empty string`;
  if (!isSortedUniqueNonEmptyStrings(item.profiles)) {
    return `${prefix}.profiles must be an array of strings that is sorted, unique, and non-empty`;
  }
  return null;
}

function checkSingleExclusionRule(
  rule: unknown,
  policyProfiles: Set<string>,
  previousPattern: string,
  exclusionRuleKeys: Set<string>
): { err: string | null; pattern: string } {
  if (!isPlainRecord(rule)) return { err: 'context_exclusions.rules items must be objects', pattern: previousPattern };
  const tupleErr = checkExclusionTupleFields(rule, 'context_exclusions.rules[]');
  if (tupleErr) return { err: tupleErr, pattern: previousPattern };
  const pat = rule.pattern as string;
  const profiles = rule.profiles as string[];
  if (!isSafeRepoGlob(pat)) {
    return { err: 'context_exclusions.rules[].pattern must be a safe repo-relative POSIX pattern', pattern: previousPattern };
  }
  if (profiles.some((p) => !policyProfiles.has(p))) {
    return {
      err: 'context_exclusions.rules[].profiles must be included in context_exclusions.profiles',
      pattern: previousPattern
    };
  }
  if (previousPattern && previousPattern.localeCompare(pat) >= 0) {
    return { err: 'context_exclusions.rules must be sorted and unique by pattern', pattern: previousPattern };
  }
  exclusionRuleKeys.add(JSON.stringify([pat, rule.reason, profiles]));
  return { err: null, pattern: pat };
}

function checkContextExclusionsBlock(ceRaw: unknown, exclusionRuleKeys: Set<string>): string | null {
  if (!isPlainRecord(ceRaw)) return 'context_exclusions must be an object';
  if (!isSortedUniqueNonEmptyStrings(ceRaw.profiles)) {
    return 'context_exclusions.profiles must be an array of strings that is sorted, unique, and non-empty';
  }
  if (!isSortedUniqueNonEmptyStrings(ceRaw.include_globs)) {
    return 'context_exclusions.include_globs must be an array of strings that is sorted, unique, and non-empty';
  }
  if (ceRaw.include_globs.some((glob) => !isSafeRepoGlob(glob))) {
    return 'context_exclusions.include_globs must contain safe repo-relative POSIX globs';
  }
  if (!Array.isArray(ceRaw.rules)) return 'context_exclusions.rules must be an array';
  let prevPattern = '';
  const policyProfiles = new Set(ceRaw.profiles);
  for (const rule of ceRaw.rules) {
    const res = checkSingleExclusionRule(rule, policyProfiles, prevPattern, exclusionRuleKeys);
    if (res.err) return res.err;
    prevPattern = res.pattern;
  }
  return null;
}

function checkOmittedPathOrdering(
  omPath: string,
  prevPath: string,
  selectionPaths: Set<string>
): string | null {
  if (prevPath && prevPath.localeCompare(omPath) >= 0) {
    return 'omitted_context must be sorted and unique by path';
  }
  if (selectionPaths.has(omPath)) {
    return `omitted_context[].path '${omPath}' also appears in selection.files`;
  }
  return null;
}

function checkSingleOmittedEntry(
  om: unknown,
  exclusionRuleKeys: Set<string>,
  selectionPaths: Set<string>,
  prevPath: string
): { err: string | null; path: string } {
  if (!isPlainRecord(om)) return { err: 'omitted_context items must be objects', path: prevPath };
  if (typeof om.path !== 'string' || !isCanonicalRepoRelative(om.path)) {
    return { err: 'omitted_context[].path must be a canonical repo-relative POSIX path', path: prevPath };
  }
  const tupleErr = checkExclusionTupleFields(om, 'omitted_context[]');
  if (tupleErr) return { err: tupleErr, path: prevPath };
  if (!exclusionRuleKeys.has(JSON.stringify([om.pattern, om.reason, om.profiles]))) {
    return { err: 'omitted_context[] must reference a rule in context_exclusions.rules', path: prevPath };
  }
  const orderErr = checkOmittedPathOrdering(om.path, prevPath, selectionPaths);
  return { err: orderErr, path: om.path };
}

function checkArtifactExclusionsAndOmitted(
  a: Record<string, unknown>,
  selectionPaths: Set<string>
): string | null {
  if ((a.context_exclusions === undefined) !== (a.omitted_context === undefined)) {
    return 'context_exclusions and omitted_context must either both be present or both be absent';
  }
  if (a.context_exclusions === undefined) return null;
  const exclusionRuleKeys = new Set<string>();
  const ceErr = checkContextExclusionsBlock(a.context_exclusions, exclusionRuleKeys);
  if (ceErr) return ceErr;
  if (!Array.isArray(a.omitted_context)) return 'omitted_context must be an array';
  let prevPath = '';
  for (const om of a.omitted_context) {
    const res = checkSingleOmittedEntry(om, exclusionRuleKeys, selectionPaths, prevPath);
    if (res.err) return res.err;
    prevPath = res.path;
  }
  return null;
}

export function checkArtifactStructure(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'artifact is not an object';
  const a = raw as Record<string, unknown>;
  const preliminary = [
    checkArtifactHeader(a),
    checkArtifactOptionalMetadata(a),
    checkArtifactRepoBlock(a),
    checkArtifactBudgetBlock(a),
    checkArtifactSelectionBlock(a)
  ].find((err) => err !== null);
  if (preliminary) return preliminary;

  const selFiles = (a.selection as { files: Array<{ path: string }> }).files;
  const selectionPaths = new Set(selFiles.map((f) => f.path));
  return checkArtifactCollections(a, selectionPaths) ?? checkArtifactExclusionsAndOmitted(a, selectionPaths);
}

function checkArtifactGraphPaths(artifact: CompiledContextArtifact, depPaths: Set<string>): string | null {
  const missingSel = artifact.selection.files.find((f) => !depPaths.has(f.path));
  if (missingSel) return `selection.files path '${missingSel.path}' not in dependency graph`;
  const missingExc = artifact.excerpts.find((e) => !depPaths.has(e.path));
  if (missingExc) return `excerpts path '${missingExc.path}' not in dependency graph`;
  const missingOm = (artifact.omitted_context ?? []).find((o) => !depPaths.has(o.path));
  if (missingOm) return `omitted_context path '${missingOm.path}' not in dependency graph`;
  return null;
}

function normalizeValidatedArtifact(artifact: CompiledContextArtifact): CompiledContextArtifact {
  return {
    ...artifact,
    task_id: artifact.task_id ?? null,
    artifact_role: artifact.artifact_role ?? 'primary',
    mode: artifact.mode ?? 'compact',
    experiment_id: artifact.experiment_id ?? null,
    parent_artifact: artifact.parent_artifact ?? null,
    context_exclusions: artifact.context_exclusions ?? { profiles: [], include_globs: [], rules: [] },
    omitted_context: artifact.omitted_context ?? []
  };
}

export function validateArtifact(artifactPath: string, repositoryRoot: string): ArtifactValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return { status: 'invalid', detail: `cannot parse artifact: ${getErrorMessage(error)}` };
  }
  const structureError = checkArtifactStructure(raw);
  if (structureError) return { status: 'invalid', detail: structureError };
  const artifact = raw as CompiledContextArtifact;

  const depGraph = readDependencyGraph(repositoryRoot);
  const health = checkDependencyGraphHealth(repositoryRoot, depGraph);
  if (health.status !== 'ok') {
    return { status: 'invalid', detail: `dependency graph is ${health.status}: ${health.detail}` };
  }
  if (artifact.repository.fingerprint !== depGraph!.repository.fingerprint) {
    return { status: 'stale', detail: 'artifact fingerprint does not match dependency graph; run --compile-context again' };
  }
  const depPaths = new Set(depGraph!.nodes.map((n) => n.path));
  const pathErr = checkArtifactGraphPaths(artifact, depPaths);
  if (pathErr) return { status: 'invalid', detail: pathErr };

  const declared = artifact.budget.estimated_tokens;
  const recomputed = computeArtifactEstimate(artifact);
  if (declared !== recomputed) {
    return { status: 'invalid', detail: `declared estimated_tokens ${declared} does not match recomputed ${recomputed}` };
  }
  if (declared > artifact.budget.limit_tokens) {
    return { status: 'invalid', detail: `estimated_tokens ${declared} exceeds limit_tokens ${artifact.budget.limit_tokens}` };
  }
  return { status: 'ok', artifact: normalizeValidatedArtifact(artifact) };
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
  const msg = `artifact is valid (estimated ${result.artifact.budget.estimated_tokens}/${result.artifact.budget.limit_tokens} tokens)`;
  process.stderr.write(`${formatStatus('ok', msg)}\n`);
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
    arg.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder) => {
      const val = Object.hasOwn(map, placeholder) ? map[placeholder] : undefined;
      if (val === undefined) {
        unresolved.push(placeholder);
        return placeholder;
      }
      return val;
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

function failCliRoute(message: string): null {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  return null;
}

function validateCliAdapterModes(adapterName: string, adapter: Adapter): string | null {
  if (adapter.input === 'argv') {
    return 'Error: argv adapters cannot deliver compiled context in Phase 11.\nUse a stdin adapter (claude, codex, agy) or pipe to stdout with --adapter omitted.';
  }
  if (adapter.input !== 'stdin') {
    return `Error: adapter input mode '${String(adapter.input)}' is not supported.`;
  }
  if (adapter.payload !== undefined && adapter.payload !== 'artifact' && adapter.payload !== 'assignment') {
    return `Error: adapter '${adapterName}' payload must be 'artifact' or 'assignment'.`;
  }
  if (adapter.output !== undefined && adapter.output !== 'text' && adapter.output !== 'json') {
    return `Error: adapter '${adapterName}' output must be 'text' or 'json'.`;
  }
  return null;
}

function validateCliAdapterInputAndPayload(adapterName: string, adapter: Adapter): string | null {
  const modeErr = validateCliAdapterModes(adapterName, adapter);
  if (modeErr) return modeErr;
  const adapterArgs = adapter.args ?? [];
  if (!Array.isArray(adapterArgs) || adapterArgs.some((a) => typeof a !== 'string')) {
    return `Error: adapter '${adapterName}' args must be an array of strings.`;
  }
  return null;
}

function validateHealthcheckFields(adapterName: string, hc: Record<string, unknown>): string | null {
  const hcArgs = hc.args;
  if (hcArgs !== undefined && (!Array.isArray(hcArgs) || hcArgs.some((a) => typeof a !== 'string'))) {
    return `Error: adapter '${adapterName}' healthcheck.args must be an array of strings.`;
  }
  const hcTimeout = hc.timeout_ms;
  if (hcTimeout !== undefined && !isPositiveInteger(hcTimeout)) {
    return `Error: adapter '${adapterName}' healthcheck.timeout_ms must be a positive integer.`;
  }
  return null;
}

function verifyCliAdapterHealthcheck(adapterName: string, adapter: Adapter): string | null {
  if (adapter.healthcheck === undefined) return null;
  if (!isPlainRecord(adapter.healthcheck)) {
    return `Error: adapter '${adapterName}' healthcheck must be a plain object.`;
  }
  const fieldErr = validateHealthcheckFields(adapterName, adapter.healthcheck);
  if (fieldErr) return fieldErr;
  const hcArgs = (adapter.healthcheck.args as string[] | undefined) ?? [];
  const hcTimeout = adapter.healthcheck.timeout_ms as number | undefined;
  const hcResult = spawnSync(adapter.command!, hcArgs, { timeout: hcTimeout, encoding: 'utf8' });
  return hcResult.error || hcResult.status !== 0 ? `Error: healthcheck for '${adapterName}' failed.` : null;
}

function tryParseCliConfigText(configPath: string): { ok: true; raw: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, raw: JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: `Error: invalid ${ADAPTERS_RELATIVE}: ${getErrorMessage(error)}` };
  }
}

function readCliAdapterConfigFile(
  configPath: string
): { ok: true; config: AdapterConfig } | { ok: false; error: string } {
  if (!fs.existsSync(configPath)) {
    return { ok: false, error: `Error: ${ADAPTERS_RELATIVE} not found. Run forgeai-init first.` };
  }
  const parsed = tryParseCliConfigText(configPath);
  if (!parsed.ok) return parsed;
  if (typeof parsed.raw !== 'object' || parsed.raw === null) {
    return { ok: false, error: `Error: invalid ${ADAPTERS_RELATIVE}: must be a JSON object.` };
  }
  return { ok: true, config: parsed.raw as AdapterConfig };
}

function loadValidatedCliAdapter(
  adapterName: string,
  repositoryRoot: string
): { ok: true; adapter: Adapter } | { ok: false; error: string } {
  const parsed = readCliAdapterConfigFile(path.join(repositoryRoot, ADAPTERS_RELATIVE));
  if (!parsed.ok) return parsed;
  const cliAdapters = parsed.config.adapters;
  const adapter = cliAdapters && Object.hasOwn(cliAdapters, adapterName) ? cliAdapters[adapterName] : undefined;
  if (!adapter) return { ok: false, error: `Error: adapter '${adapterName}' not found in ${ADAPTERS_RELATIVE}.` };
  if (!isNonEmptyString(adapter.command)) {
    return { ok: false, error: `Error: adapter '${adapterName}' has no command configured.` };
  }
  const err = validateCliAdapterInputAndPayload(adapterName, adapter) ?? verifyCliAdapterHealthcheck(adapterName, adapter);
  return err ? { ok: false, error: err } : { ok: true, adapter };
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidationEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const rec = entry as Record<string, unknown>;
  return typeof rec.command === 'string' && typeof rec.passed === 'boolean';
}

function isValidAgentResponse(raw: unknown): raw is AgentResponse {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (!['completed', 'blocked', 'needs-review'].includes(String(r.status))) return false;
  if (!isNonEmptyTrimmedString(r.summary) || !isNonEmptyTrimmedString(r.next_action)) return false;
  if (!isStringArray(r.changed_files) || !isStringArray(r.risks)) return false;
  return Array.isArray(r.validation) && r.validation.every(isValidationEntry);
}

export function tryParseAgentResponse(rawText: string): AgentResponse | null {
  let candidate: unknown = null;
  try { candidate = JSON.parse(rawText); } catch { candidate = null; }
  return isValidAgentResponse(candidate) ? candidate : null;
}

function handleStrictJsonCliOutput(
  adapterName: string,
  adapterLabel: string,
  stdout: unknown,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  model: string | null,
  quiet: boolean,
  repositoryRoot: string
): AgentResponse | null {
  const text = typeof stdout === 'string' ? stdout.trim() : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'failed (invalid json output)'), repositoryRoot);
    return failCliRoute(`Error: adapter '${adapterName}' returned invalid JSON; configure output=text or fix the model response.`);
  }
  if (!isValidAgentResponse(parsed)) {
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'failed (invalid response contract)'), repositoryRoot);
    return failCliRoute(`Error: adapter '${adapterName}' returned JSON that does not match the ForgeAI response contract.`);
  }
  appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'ok'), repositoryRoot);
  if (!quiet) process.stdout.write(`${JSON.stringify(parsed)}\n`);
  return parsed;
}

function finalizeCliProcessResult(
  result: ReturnType<typeof spawnSync>,
  strictJsonOutput: boolean,
  adapterName: string,
  adapterLabel: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  model: string | null,
  quiet: boolean,
  repositoryRoot: string
): AgentResponse | null {
  if (result.error) {
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'failed (spawn error)'), repositoryRoot);
    return failCliRoute(`Error: failed to spawn adapter '${adapterName}': ${result.error.message}`);
  }
  if (result.signal) {
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, `failed (signal ${result.signal})`), repositoryRoot);
    return failCliRoute(`Error: adapter '${adapterName}' killed by signal ${result.signal}.`);
  }
  const exitCode = result.status ?? 0;
  if (exitCode === 0 && strictJsonOutput) {
    return handleStrictJsonCliOutput(adapterName, adapterLabel, result.stdout, artifact, artifactPath, model, quiet, repositoryRoot);
  }
  const status = exitCode === 0 ? 'ok' : `failed (exit ${exitCode})`;
  appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, status), repositoryRoot);
  if (exitCode !== 0) failCliRoute(`Error: adapter '${adapterName}' exited with code ${exitCode}.`);
  return null;
}

function routeCliAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string,
  model: string | null,
  repositoryRoot: string,
  json: string,
  quiet = false
): AgentResponse | null | undefined {
  const loaded = loadValidatedCliAdapter(adapterName, repositoryRoot);
  if (!loaded.ok) {
    failCliRoute(loaded.error);
    return;
  }
  const { adapter } = loaded;
  const { resolved, unresolved } = resolvePlaceholders((adapter.args ?? []) as string[], {
    model: model ?? undefined,
    assignment: artifact.objective,
    tokenBudget: artifact.budget.limit_tokens
  });
  if (unresolved.length > 0) {
    failCliRoute(`Error: unresolved placeholders in adapter args: ${unresolved.join(', ')}`);
    return;
  }
  const inputPayload = adapter.payload === 'assignment' ? renderAgentAssignment(artifact) : json;
  const strictJsonOutput = adapter.output === 'json';
  const stdoutMode = strictJsonOutput || quiet ? 'pipe' : 'inherit';
  const result = spawnSync(adapter.command!, resolved, {
    cwd: repositoryRoot,
    input: inputPayload,
    stdio: ['pipe', stdoutMode, 'inherit'],
    encoding: 'utf8'
  });
  return finalizeCliProcessResult(
    result,
    strictJsonOutput,
    adapterName,
    `${adapterName} (stdin)`,
    artifact,
    artifactPath,
    model,
    quiet,
    repositoryRoot
  );
}

export type RouteAdapterOptions = {
  codeMode?: boolean;
  writeScope?: string[];
  readScope?: string[];
};

function handleApiAdapterFailure(
  result: Awaited<ReturnType<typeof callApiAdapter>>['result'],
  apiEntry: ApiAdapterEntry,
  adapterName: string,
  effectiveModel: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string,
  json: string,
  quiet: boolean
): AgentResponse | null | undefined {
  if (result.streamed) {
    return failCliRoute(`Error: API adapter '${adapterName}' failed mid-stream: ${result.error ?? 'unknown'}`);
  }
  if (result.error_kind === 'auth') {
    return failCliRoute(`Error: API adapter '${adapterName}' authentication failed: ${result.error ?? ''}`);
  }
  if (result.error_kind === 'quota') {
    const cliFallback = apiEntry.fallback_adapter ?? adapterName;
    process.stderr.write(`${formatStatus('warn', `API adapter '${adapterName}' hit quota; falling back to CLI adapter '${cliFallback}'`)}\n`);
    return routeCliAdapter(artifact, artifactPath, cliFallback, effectiveModel, repositoryRoot, json, quiet);
  }
  return failCliRoute(`Error: API adapter '${adapterName}' failed: ${result.error ?? 'unknown'}`);
}

function recordApiRouteJournal(
  adapterName: string,
  effectiveModel: string,
  result: Awaited<ReturnType<typeof callApiAdapter>>['result'],
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string
): void {
  const status = result.ok ? 'ok' : `failed (${result.error_kind ?? 'error'})`;
  const suffix = result.streamed ? ', stream' : '';
  appendJournal(buildJournalEntry(artifact, artifactPath, `${adapterName} (api${suffix})`, effectiveModel, status), repositoryRoot);
}

function buildCodeModeRouteOptions(
  useCodeMode: boolean,
  repositoryRoot: string,
  artifact: CompiledContextArtifact,
  routeOptions: RouteAdapterOptions
) {
  if (!useCodeMode) return undefined;
  return {
    repositoryRoot,
    primaryArtifact: artifact,
    writeScope: routeOptions.writeScope,
    readScope: routeOptions.readScope
  };
}

function finalizeSuccessfulApiRoute(
  result: Awaited<ReturnType<typeof callApiAdapter>>['result'],
  useCodeMode: boolean,
  quiet: boolean
): AgentResponse | null {
  if (!quiet && !result.streamed && result.text) process.stdout.write(result.text);
  return useCodeMode && result.text ? tryParseAgentResponse(result.text) : null;
}

async function executeApiAdapterRoute(
  apiEntry: ApiAdapterEntry,
  adapterName: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  model: string | null,
  repositoryRoot: string,
  stream: boolean,
  quiet: boolean,
  json: string,
  routeOptions: RouteAdapterOptions
): Promise<AgentResponse | null | undefined> {
  const effectiveModel = model ?? apiEntry.model;
  const useCodeMode = Boolean(routeOptions.codeMode || codeModeFlag || apiEntry.code_mode);
  const { result } = await callApiAdapter(adapterName, artifact, artifactPath, repositoryRoot, model, {
    stream,
    onDelta: (t) => { if (!quiet) process.stdout.write(t); },
    codeMode: useCodeMode,
    codeModeOptions: buildCodeModeRouteOptions(useCodeMode, repositoryRoot, artifact, routeOptions)
  });
  recordApiRouteJournal(adapterName, effectiveModel, result, artifact, artifactPath, repositoryRoot);

  if (!result.ok) {
    return handleApiAdapterFailure(result, apiEntry, adapterName, effectiveModel, artifact, artifactPath, repositoryRoot, json, quiet);
  }
  return finalizeSuccessfulApiRoute(result, useCodeMode, quiet);
}

export async function routeToAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string | null,
  model: string | null,
  repositoryRoot: string,
  stream = false,
  quiet = false,
  routeOptions: RouteAdapterOptions = {}
): Promise<AgentResponse | null | undefined> {
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  if (!adapterName) {
    process.stdout.write(json);
    appendJournal(buildJournalEntry(artifact, artifactPath, 'stdout', model, 'ok'), repositoryRoot);
    return null;
  }

  const loaded = loadApiAdapters(repositoryRoot);
  if (loaded !== null && !loaded.ok) {
    failCliRoute(`Error: invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}`);
    return;
  }

  const adapterMap = loaded?.ok ? loaded.config.adapters : undefined;
  const apiEntry = adapterMap && Object.hasOwn(adapterMap, adapterName) ? adapterMap[adapterName] : undefined;
  if (apiEntry) {
    return executeApiAdapterRoute(
      apiEntry, adapterName, artifact, artifactPath, model, repositoryRoot, stream, quiet, json, routeOptions
    );
  }

  if (stream) {
    process.stderr.write(`${formatStatus('warn', `--stream has no effect on CLI adapter '${adapterName}' (it already streams via stdio)`)}\n`);
  }
  return routeCliAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, json, quiet);
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
