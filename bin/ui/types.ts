export type AgentStatus = 'pending' | 'running' | 'success' | 'fail';
export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'warning';

export type AgentState = {
  agentId: string;
  role: string;
  task: string;
  status: AgentStatus;
  message: string;
  startedAt: number;
  doneAt?: number;
};

export type LogEntry = {
  ts: number;
  text: string;
  level: 'info' | 'warn' | 'error';
};

export type AppState = {
  connected: boolean;
  disconnected: boolean;
  task: string | null;
  agents: Record<string, AgentState>;
  logs: LogEntry[];
  checks: Record<string, CheckStatus>;
};

export type ForgeEvent = {
  type: string;
  ts: number;
  agentId?: string;
  role?: string;
  task?: string;
  message?: string;
  status?: string;
  name?: string;
  target?: string;
  raw?: string;
  adapter?: string;
  provider?: string;
  model?: string;
  attempt?: number;
  error_kind?: string;
  delay_ms?: number;
  outcome?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  latency_ms?: number;
  retry_count?: number;
};
