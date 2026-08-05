export type Adapter = {
  command?: string;
  args?: string[];
  healthcheck?: {
    args?: string[];
    timeout_ms?: number;
  };
  input?: 'stdin' | 'argv';
  quota_patterns?: string[];
};

export type AdapterConfig = {
  version?: number;
  fallback?: unknown;
  adapters?: Record<string, Adapter>;
};

export type HarnessManifest = {
  version: number;
  package: string;
  package_version: string;
  profile: string;
  initialized_at: string;
};

export type AgentSession = {
  id: string;
  owner: string;
  task: string;
  branch: string;
  status: string;
  started: string;
  readScope: string[];
  writeScope: string[];
  notes: string;
};

export type TaskJournal = {
  file: string;
  taskId: string;
  taskType: string;
  currentState: string;
  lastUpdated: string;
  staleStatus: string;
  memoryUpdateChecked: boolean;
  noMemoryUpdateChecked: boolean;
};

export type CodeGraphNode = {
  id?: string;
  path?: string;
  type?: string;
  summary?: string;
  owners?: string[];
  entrypoints?: string[];
  public_contracts?: string[];
  dependencies?: string[];
  dependents?: string[];
  tags?: string[];
  confidence?: string;
};

export type CodeGraphEdge = {
  from?: string;
  to?: string;
  kind?: string;
  summary?: string;
  confidence?: string;
};

export type CodeGraph = {
  schema_version?: number;
  generated_at?: string;
  source?: string;
  repository?: {
    name?: string;
    root?: string;
    profile?: string;
  };
  nodes?: CodeGraphNode[];
  edges?: CodeGraphEdge[];
};

export type DependencyGraphNode = {
  id: string;
  path: string;
  hash: string;
  exports: string[];
  declarations?: string[];
  language?: string;   // 'typescript' | 'python'; absent = legacy (treated as typescript)
};

export type DependencyEdgeKind = 'static_import' | 'dynamic_import' | 'require';

export type DependencyGraphEdge = {
  from: string;
  to: string;
  kind: DependencyEdgeKind;
  specifier: string;
};

export type UnresolvedDependency = {
  from: string;
  kind: DependencyEdgeKind;
  specifier: string;
  reason: 'dynamic_expression' | 'external_package' | 'unresolved_local';
};

export type DependencyGraph = {
  schema_version: 1;
  generated_at: string;
  source: 'forgeai-static-analysis';
  repository: {
    root: '.';
    revision: string | null;
    fingerprint: string;
  };
  settings: {
    extensions: string[];
    ignored_directories: string[];
  };
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  unresolved: UnresolvedDependency[];
};

export type CompiledContextExcerpt = {
  path: string;
  kind: 'import' | 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'test' | 'file';
  name: string;
  reason: string;
  source_start_line: number;
  source_end_line: number;
  mode: 'full' | 'signature';
  content: string;
};

export type CompiledRuleSection = {
  path: '.ai/RULES.md';
  heading: string;
  reason: string;
  source_start_line: number;
  source_end_line: number;
  content: string;
};

export type CompiledDiagnostics = {
  git: {
    available: boolean;
    branch: string | null;
    revision: string | null;
    staged: number;
    unstaged: number;
    untracked: number;
    changed_files: Array<{ path: string; state: string }>;
    changed_files_truncated: boolean;
    diff: Array<{ path: string; insertions: number | null; deletions: number | null; binary: boolean }>;
    diff_truncated: boolean;
    error: string | null;
  };
  validation: {
    package_manager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
    scripts: Array<{ name: string; command: string }>;
  };
};

export type ProfileExclusionRule = {
  pattern: string;   // authored token, e.g. "migrations/"
  reason: string;
};

export type ResolvedExclusionRule = ProfileExclusionRule & {
  profiles: string[];   // sorted contributors after composite dedupe
};

export type ContextExclusionPolicy = {
  profiles: string[];               // normalized, sorted, deduped components
  include_globs: string[];          // normalized repo-relative overrides
  rules: ResolvedExclusionRule[];   // exact snapshot used by this artifact
};

export type OmittedContextEntry = {
  path: string;
  pattern: string;
  profiles: string[];
  reason: string;
};

export type CompiledContextArtifact = {
  schema_version: 1;
  kind: 'forgeai_compiled_context';
  objective: string;
  task_id: string | null;
  artifact_role: 'primary' | 'expansion';
  mode: 'baseline' | 'compact';
  experiment_id: string | null;
  parent_artifact: string | null;
  repository: {
    revision: string | null;
    fingerprint: string;
  };
  budget: {
    limit_tokens: number;
    estimated_tokens: number;
    estimator: 'characters_divided_by_4';
    exhausted: boolean;
  };
  selection: {
    max_depth: number;
    max_nodes: number;
    files: Array<{
      path: string;
      depth: number;
      reason: string;
      graph_path: string;
    }>;
  };
  rules: CompiledRuleSection[];
  diagnostics: CompiledDiagnostics;
  contracts: string[];
  entrypoints: string[];
  excerpts: CompiledContextExcerpt[];
  omitted_candidates: number;
  context_exclusions: ContextExclusionPolicy;
  omitted_context: OmittedContextEntry[];
};

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

export type NeedContextRequestItem =
  | { kind: 'symbol'; name: string; reason: string }
  | { kind: 'file';   path: string; reason: string }
  | { kind: 'test';   path: string; reason: string };

export type NeedContextArtifact = {
  kind: 'forgeai_need_context';
  schema_version: 1;
  artifact: string;
  requests: NeedContextRequestItem[];
};

export type EscapeReasonCode =
  | 'missing_reason' | 'missing_path' | 'missing_name'
  | 'ignored_path' | 'path_not_in_graph' | 'symbol_not_found'
  | 'unknown_kind' | 'budget_exceeded' | 'no_new_context'
  | 'profile_excluded';

// A persisted snapshot of the request that was declined. It is deliberately NOT
// a NeedContextRequestItem: escapes such as missing_reason / missing_name /
// unknown_kind are recorded precisely because the submitted request was malformed.
export type RejectedRequestSnapshot = Record<string, unknown>;

export type ContextEscapeEvent = {
  schema_version: 1;
  kind: 'forgeai_context_escape_event';
  escape_id: string;
  task_id: string;
  recorded_at: string;
  primary_artifact: string;
  primary_digest: string;
  request: RejectedRequestSnapshot;
  status: 'rejected';
  reason_code: EscapeReasonCode;
  detail: string;
};

export type ContextEscapeObservation = {
  schema_version: 1;
  kind: 'forgeai_context_escape_observation';
  task_id: string;
  recorded_at: string;
  primary_artifact: string;
  primary_digest: string;
};

export type ArtifactValidationResult =
  | { status: 'ok';      artifact: CompiledContextArtifact }
  | { status: 'invalid'; detail: string }
  | { status: 'stale';   detail: string };

export type ResolvedContextRequest = {
  requestKind: 'symbol' | 'file' | 'test';
  path: string;
  symbol?: string;
  reason: string;
};

export type ApiAdapterProvider = 'anthropic' | 'openai' | 'gemini';

export type ApiAdapterEntry = {
  provider: ApiAdapterProvider;
  model: string;
  max_tokens?: number;
  system?: string;
  timeout_ms?: number;
  fallback_adapter?: string;
  max_retries?: number;
  retry_base_ms?: number;
};

export type ApiAdapterConfig = {
  version?: number;
  adapters?: Record<string, ApiAdapterEntry>;
};

export type ApiCallResult = {
  ok: boolean;
  text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  latency_ms: number;
  http_status: number | null;
  error_kind: 'auth' | 'quota' | 'network' | 'provider' | 'invalid_response' | null;
  retryable: boolean;
  streamed: boolean;
  retry_count: number;
  error: string | null;
};

export type RunRecord = {
  schema_version: 1;
  kind: 'forgeai_run_record';
  run_id: string;
  timestamp: string;
  adapter: string;
  provider: ApiAdapterProvider;
  model: string;
  artifact: string;
  objective: string;
  task_id: string | null;
  mode: 'baseline' | 'compact' | null;
  budget_tokens: number;
  estimated_tokens: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  latency_ms: number;
  http_status: number | null;
  outcome: 'ok' | 'quota' | 'auth' | 'error';
  retry_count: number;
  error: string | null;
};

export type EvaluationOutcome = 'pass' | 'fail' | 'partial';

export type EvaluationComparability = {
  objective: string;
  repository_fingerprint: string;
  selection_signature: string;
  acceptance_signature: string;
  routing_signature: string;
};

// The origin of an evaluation record's outcome. `review_scorecard` derives it from
// the review verdict (today's behaviour); `manual_override` records a human decision
// on a `needs human decision` verdict, with provenance.
export type EvaluationOutcomeSource =
  | { type: 'review_scorecard'; scorecard: string; verdict: string }
  | {
      type: 'manual_override';
      scorecard: string;
      verdict: string;
      decided_outcome: 'pass' | 'fail';
      reason: string;
      decided_by: string;
      decided_at: string;
    };

// A single provider/model pair, derived from a record's runs. Stored structured (not
// as a `provider/model` string) so a model id containing "/" or "," can't break it.
export type RoutingSignature = { provider: string; model: string };

export type EvaluationRecord = {
  kind: 'forgeai_evaluation_record';
  schema_version: 1;
  evaluation_id: string;
  task_id: string;
  generated_at: string;
  mode: 'baseline' | 'compact';
  experiment_id: string | null;
  comparability: EvaluationComparability | null;
  outcome: EvaluationOutcome;
  outcome_source: EvaluationOutcomeSource;
  routing_signatures: RoutingSignature[];
  validation: {
    status: 'pass' | 'fail' | 'partial';
    evidence_count: number;
    results: { pass: number; fail: number; skipped: number };
  };
  run_ids: string[];
  context_artifact: string | null;
  task_journal: string;
  tier: string;
  metrics: {
    context: {
      selected_files: number;
      excerpts: number;
      omitted_candidates: number;
      budget_limit_tokens: number;
      budget_estimated_tokens: number;
      budget_utilization: number;
      expansion_rounds: number;
      context_escapes: number | null;
    };
    calls: {
      model_calls: number;
      input_tokens: number;
      output_tokens: number;
      cached_tokens: number;
      latency_ms: number;
      retries: number;
    };
  };
};

// The shape the validator accepts off disk: a legacy (3.9.0) record may omit the
// fields the reader normalises (`mode`/`experiment_id`/`comparability`/
// `routing_signatures`), so they are optional here. `isValidEvaluationRecord` narrows
// to this; the read path fills the defaults to produce a full `EvaluationRecord`.
export type EvaluationRecordWire = Omit<
  EvaluationRecord,
  'mode' | 'experiment_id' | 'comparability' | 'routing_signatures'
> & {
  mode?: EvaluationRecord['mode'];
  experiment_id?: EvaluationRecord['experiment_id'];
  comparability?: EvaluationRecord['comparability'];
  routing_signatures?: RoutingSignature[];
};
