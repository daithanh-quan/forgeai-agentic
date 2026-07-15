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
  kind: 'import' | 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'test';
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

export type CompiledContextArtifact = {
  schema_version: 1;
  kind: 'forgeai_compiled_context';
  objective: string;
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
