import { Box, Text } from 'ink';
import React from 'react';

type Props = { connected: boolean };

export function Header({ connected }: Props) {
  const now = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const icon = connected ? '●' : '○';
  const label = connected ? 'LIVE' : 'WAITING';
  const color = connected ? 'green' : 'gray';

  return (
    <Box paddingX={1} justifyContent="space-between" borderStyle="single">
      <Text bold>ForgeAI Orchestration Monitor</Text>
      <Text color={color}>
        {icon} {label}  {now}
      </Text>
    </Box>
  );
}
