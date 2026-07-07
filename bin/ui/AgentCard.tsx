import { Box, Text } from 'ink';
import React from 'react';
import type { AgentState } from './types.js';

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '⟳',
  success: '✓',
  fail: '✗',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  success: 'green',
  fail: 'red',
};

export function AgentCard({ agent }: { agent: AgentState }) {
  const icon = STATUS_ICON[agent.status] ?? '?';
  const color = STATUS_COLOR[agent.status] ?? 'white';
  const detail =
    agent.doneAt !== undefined
      ? `done in ${agent.doneAt - agent.startedAt}s`
      : agent.message;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={color}>{icon} </Text>
        <Text bold>{agent.agentId}</Text>
        <Text dimColor>  [{agent.role}]</Text>
      </Text>
      <Text dimColor>  {detail}</Text>
    </Box>
  );
}
