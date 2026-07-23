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

function toCheckStatus(s: string | undefined): CheckStatus {
  if (s === 'pass') return 'pass';
  if (s === 'fail') return 'fail';
  if (s === 'warning') return 'warning';
  if (s === 'running') return 'running';
  return 'pending';
}

export function reducer(state: AppState, event: ForgeEvent): AppState {
  const { ts } = event;

  switch (event.type) {
    case 'orchestrator.start': {
      const orchAgent: AgentState = {
        agentId: 'orchestrator',
        role: 'orchestrator',
        task: event.task ?? '',
        status: 'running',
        message: 'running...',
        startedAt: ts,
      };
      return appendLog(
        { ...state, connected: true, task: event.task ?? null, agents: { ...state.agents, orchestrator: orchAgent } },
        'orchestrator started',
        ts,
      );
    }

    case 'orchestrator.done': {
      const existing = state.agents['orchestrator'];
      const updatedAgents = existing
        ? { ...state.agents, orchestrator: { ...existing, status: toAgentStatus(event.status), doneAt: ts } }
        : state.agents;
      return appendLog({ ...state, agents: updatedAgents }, `orchestrator ${event.status ?? 'done'}`, ts);
    }

    case 'agent.assigned': {
      const id = event.agentId ?? '';
      const agent: AgentState = {
        agentId: id,
        role: event.role ?? 'agent',
        task: event.task ?? '',
        status: 'running',
        message: 'assigned',
        startedAt: ts,
      };
      return appendLog(
        markConnected({ ...state, agents: { ...state.agents, [id]: agent } }),
        `assigned ${id} → ${event.role ?? 'agent'}`,
        ts,
      );
    }

    case 'agent.progress': {
      const id = event.agentId ?? '';
      const existing = state.agents[id];
      if (!existing) return state;
      return {
        ...state,
        agents: { ...state.agents, [id]: { ...existing, message: event.message ?? '' } },
      };
    }

    case 'agent.done': {
      const id = event.agentId ?? '';
      const existing = state.agents[id];
      if (!existing) return state;
      return appendLog(
        {
          ...state,
          agents: {
            ...state.agents,
            [id]: { ...existing, status: toAgentStatus(event.status), doneAt: ts },
          },
        },
        `${id} ${event.status ?? 'done'}`,
        ts,
      );
    }

    case 'review.start': {
      const id = event.agentId ?? '';
      const agent: AgentState = {
        agentId: id,
        role: 'reviewer',
        task: `reviewing ${event.target ?? ''}`,
        status: 'running',
        message: `reviewing ${event.target ?? ''}`,
        startedAt: ts,
      };
      return appendLog(
        markConnected({ ...state, agents: { ...state.agents, [id]: agent } }),
        `reviewer ${id} reviewing ${event.target ?? ''}`,
        ts,
      );
    }

    case 'review.done': {
      const id = event.agentId ?? '';
      const existing = state.agents[id];
      if (!existing) return state;
      return appendLog(
        {
          ...state,
          agents: {
            ...state.agents,
            [id]: { ...existing, status: toAgentStatus(event.status), doneAt: ts },
          },
        },
        `review ${event.status ?? 'done'}`,
        ts,
      );
    }

    case 'check.run':
      return appendLog(
        markConnected({ ...state, checks: { ...state.checks, [event.name ?? '']: 'running' } }),
        `⟳ ${event.name} check...`,
        ts,
      );

    case 'check.result': {
      const status = toCheckStatus(event.status);
      const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '⚠';
      return appendLog(
        markConnected({ ...state, checks: { ...state.checks, [event.name ?? '']: status } }),
        `${icon} ${event.name} ${event.status ?? ''}`,
        ts,
      );
    }

    case '_clear_log':
      return { ...state, logs: [] };

    case '_disconnected':
      return appendLog({ ...state, disconnected: true }, '[!] connection lost', ts, 'warn');

    case 'run_start':
      return appendLog(
        markConnected(state),
        `▶ run ${event.adapter} ${event.provider ?? ''}/${event.model ?? ''}`,
        ts,
      );

    case 'retry_attempt':
      return appendLog(
        state,
        `↻ ${event.adapter} retry #${event.attempt} (${event.error_kind}, ${event.delay_ms}ms)`,
        ts,
        'warn',
      );

    case 'run_complete': {
      const icon = event.outcome === 'ok' ? '✓' : '✗';
      const tokens = event.input_tokens != null ? `in=${event.input_tokens} out=${event.output_tokens}` : 'tokens=unknown';
      return appendLog(
        markConnected(state),
        `${icon} run ${event.adapter} ${event.outcome} ${tokens} ${event.latency_ms}ms`,
        ts,
        event.outcome === 'ok' ? 'info' : 'error',
      );
    }

    default:
      return appendLog(
        state,
        event.raw ?? `[warn] unknown event: ${event.type}`,
        ts,
        'warn',
      );
  }
}
