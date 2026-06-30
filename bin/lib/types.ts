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

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};
