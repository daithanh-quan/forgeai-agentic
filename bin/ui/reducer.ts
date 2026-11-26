import type { AgentState, AgentStatus, AppState, CheckStatus, ForgeEvent, LogEntry } from './types.js';

const MAX_LOG = 500;

export function initialState(): AppState {
  return {
    connected: false,
    disconnected: false,
    task: null,
    agents: {},
    logs: [],
    checks: {},
  };
}

function appendLog(state: AppState, text: string, ts: number, level: LogEntry['level'] = 'info'): AppState {
  const logs = [...state.logs, { ts, text, level }];
  return { ...state, logs: logs.length > MAX_LOG ? logs.slice(-MAX_LOG) : logs };
}

function markConnected(state: AppState): AppState {
  return state.connected ? state : { ...state, connected: true };
}

function toAgentStatus(s: string | undefined): AgentStatus {
  if (s === 'success' || s === 'pass') return 'success';
  if (s === 'fail') return 'fail';
  return 'running';
}

const CHECK_STATUS_MAP: Record<string, CheckStatus> = {
  pass: 'pass',
  fail: 'fail',
  warning: 'warning',
  running: 'running'
};

function toCheckStatus(s: string | undefined): CheckStatus {
  return (s ? CHECK_STATUS_MAP[s] : undefined) ?? 'pending';
}

function handleOrchestratorStart(state: AppState, event: ForgeEvent): AppState {
  const orchAgent: AgentState = {
    agentId: 'orchestrator',
    role: 'orchestrator',
    task: event.task ?? '',
    status: 'running',
    message: 'running...',
    startedAt: event.ts,
  };
  return appendLog(
    { ...state, connected: true, task: event.task ?? null, agents: { ...state.agents, orchestrator: orchAgent } },
    'orchestrator started',
    event.ts,
  );
}

function handleOrchestratorDone(state: AppState, event: ForgeEvent): AppState {
  const existing = state.agents['orchestrator'];
  const updatedAgents = existing
    ? { ...state.agents, orchestrator: { ...existing, status: toAgentStatus(event.status), doneAt: event.ts } }
    : state.agents;
  return appendLog({ ...state, agents: updatedAgents }, `orchestrator ${event.status ?? 'done'}`, event.ts);
}

function registerRunningAgent(
  state: AppState,
  id: string,
  role: string,
  task: string,
  message: string,
  logText: string,
  ts: number
): AppState {
  const agent: AgentState = { agentId: id, role, task, status: 'running', message, startedAt: ts };
  return appendLog(markConnected({ ...state, agents: { ...state.agents, [id]: agent } }), logText, ts);
}

function handleAgentAssigned(state: AppState, event: ForgeEvent): AppState {
  const id = event.agentId ?? '';
  const role = event.role ?? 'agent';
  return registerRunningAgent(state, id, role, event.task ?? '', 'assigned', `assigned ${id} → ${role}`, event.ts);
}

function handleAgentProgress(state: AppState, event: ForgeEvent): AppState {
  const id = event.agentId ?? '';
  const existing = state.agents[id];
  if (!existing) return state;
  return {
    ...state,
    agents: { ...state.agents, [id]: { ...existing, message: event.message ?? '' } },
  };
}

function finishTrackedAgent(state: AppState, event: ForgeEvent, labelPrefix: string): AppState {
  const id = event.agentId ?? '';
  const existing = state.agents[id];
  if (!existing) return state;
  const label = `${labelPrefix} ${event.status ?? 'done'}`;
  return appendLog(
    {
      ...state,
      agents: {
        ...state.agents,
        [id]: { ...existing, status: toAgentStatus(event.status), doneAt: event.ts },
      },
    },
    label,
    event.ts,
  );
}

function handleReviewStart(state: AppState, event: ForgeEvent): AppState {
  const id = event.agentId ?? '';
  const label = `reviewing ${event.target ?? ''}`;
  return registerRunningAgent(state, id, 'reviewer', label, label, `reviewer ${id} ${label}`, event.ts);
}

function handleCheckRun(state: AppState, event: ForgeEvent): AppState {
  const name = event.name ?? '';
  return appendLog(
    markConnected({ ...state, checks: { ...state.checks, [name]: 'running' } }),
    `⟳ ${name} check...`,
    event.ts,
  );
}

const CHECK_ICON_MAP: Record<CheckStatus, string> = {
  pass: '✓',
  fail: '✗',
  warning: '⚠',
  running: '⚠',
  pending: '⚠'
};

function handleCheckResult(state: AppState, event: ForgeEvent): AppState {
  const status = toCheckStatus(event.status);
  const icon = CHECK_ICON_MAP[status];
  const name = event.name ?? '';
  return appendLog(
    markConnected({ ...state, checks: { ...state.checks, [name]: status } }),
    `${icon} ${name} ${event.status ?? ''}`,
    event.ts,
  );
}

function handleRunComplete(state: AppState, event: ForgeEvent): AppState {
  const isOk = event.outcome === 'ok';
  const icon = isOk ? '✓' : '✗';
  const tokens = event.input_tokens != null ? `in=${event.input_tokens} out=${event.output_tokens}` : 'tokens=unknown';
  return appendLog(
    markConnected(state),
    `${icon} run ${event.adapter} ${event.outcome} ${tokens} ${event.latency_ms}ms`,
    event.ts,
    isOk ? 'info' : 'error',
  );
}

function handleCodeModeStep(state: AppState, event: ForgeEvent): AppState {
  const ops = Array.isArray(event.operations) ? event.operations.join(',') : '';
  const hasFiles = Array.isArray(event.changed_files) && event.changed_files.length > 0;
  const files = hasFiles ? ` files=[${event.changed_files!.join(',')}]` : '';
  const round = event.round ?? 1;
  const level: LogEntry['level'] = event.ok === false ? 'warn' : 'info';
  return appendLog(markConnected(state), `⚡ code-mode round #${round} ops=[${ops}]${files}`, event.ts, level);
}

const EVENT_HANDLERS: Record<string, (state: AppState, event: ForgeEvent) => AppState> = {
  'orchestrator.start': handleOrchestratorStart,
  'orchestrator.done': handleOrchestratorDone,
  'agent.assigned': handleAgentAssigned,
  'agent.progress': handleAgentProgress,
  'agent.done': (s, e) => finishTrackedAgent(s, e, e.agentId ?? ''),
  'review.start': handleReviewStart,
  'review.done': (s, e) => finishTrackedAgent(s, e, 'review'),
  'check.run': handleCheckRun,
  'check.result': handleCheckResult,
  '_clear_log': (s) => ({ ...s, logs: [] }),
  '_disconnected': (s, e) => appendLog({ ...s, disconnected: true }, '[!] connection lost', e.ts, 'warn'),
  'run_start': (s, e) => appendLog(markConnected(s), `▶ run ${e.adapter} ${e.provider ?? ''}/${e.model ?? ''}`, e.ts),
  'retry_attempt': (s, e) =>
    appendLog(s, `↻ ${e.adapter} retry #${e.attempt} (${e.error_kind}, ${e.delay_ms}ms)`, e.ts, 'warn'),
  'code_mode_step': handleCodeModeStep,
  'run_complete': handleRunComplete,
};

export function reducer(state: AppState, event: ForgeEvent): AppState {
  const handler = Object.hasOwn(EVENT_HANDLERS, event.type) ? EVENT_HANDLERS[event.type] : undefined;
  if (handler) return handler(state, event);
  return appendLog(state, event.raw ?? `[warn] unknown event: ${event.type}`, event.ts, 'warn');
}
