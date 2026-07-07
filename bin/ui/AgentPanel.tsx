import { Box, Text } from 'ink';
import React from 'react';
import { AgentCard } from './AgentCard.js';
import type { AgentState } from './types.js';

export function AgentPanel({ agents }: { agents: Record<string, AgentState> }) {
  const list = Object.values(agents);

  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        AGENTS
      </Text>
      {list.length === 0 ? (
        <Text dimColor>No agents yet...</Text>
      ) : (
        list.map((a) => <AgentCard key={a.agentId} agent={a} />)
      )}
    </Box>
  );
}
