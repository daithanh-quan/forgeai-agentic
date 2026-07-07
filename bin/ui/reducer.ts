import type { AgentState, AgentStatus, AppState, CheckStatus, ForgeEvent, LogEntry } from './types.js';

export function initialState(): AppState {
  return {
    connected: false,
    task: null,
    agents: {},
    logs: [],
    checks: {},
  };
}

function appendLog(state: AppState, text: string, ts: number, level: LogEntry['level'] = 'info'): AppState {
  return { ...state, logs: [...state.logs, { ts, text, level }] };
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
    case 'orchestrator.start':
      return appendLog(
        { ...state, connected: true, task: event.task ?? null },
        'orchestrator started',
        ts,
      );

    case 'orchestrator.done':
      return appendLog(state, `orchestrator ${event.status ?? 'done'}`, ts);

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
        { ...state, agents: { ...state.agents, [id]: agent } },
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
        { ...state, agents: { ...state.agents, [id]: agent } },
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
        { ...state, checks: { ...state.checks, [event.name ?? '']: 'running' } },
        `⟳ ${event.name} check...`,
        ts,
      );

    case 'check.result': {
      const status = toCheckStatus(event.status);
      const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '⚠';
      return appendLog(
        { ...state, checks: { ...state.checks, [event.name ?? '']: status } },
        `${icon} ${event.name} ${event.status ?? ''}`,
        ts,
      );
    }

    case '_clear_log':
      return { ...state, logs: [] };

    default:
      return appendLog(
        state,
        event.raw ?? `[warn] unknown event: ${event.type}`,
        ts,
        'warn',
      );
  }
}
