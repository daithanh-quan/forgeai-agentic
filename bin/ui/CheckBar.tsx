import { Box, Text } from 'ink';
import React from 'react';
import type { CheckStatus } from './types.js';

const CHECK_ICON: Record<CheckStatus, string> = {
  pending: '○',
  running: '⟳',
  pass: '✓',
  fail: '✗',
  warning: '⚠',
};

const CHECK_COLOR: Record<CheckStatus, string> = {
  pending: 'gray',
  running: 'yellow',
  pass: 'green',
  fail: 'red',
  warning: 'yellow',
};

export function CheckBar({ checks }: { checks: Record<string, CheckStatus> }) {
  const entries = Object.entries(checks);

  return (
    <Box paddingX={1} borderStyle="single">
      <Text bold>CHECKS  </Text>
      {entries.length === 0 ? (
        <Text dimColor>No checks run yet</Text>
      ) : (
        entries.map(([name, status]) => (
          <Text key={name} color={CHECK_COLOR[status]}>
            {CHECK_ICON[status]} {name}{'   '}
          </Text>
        ))
      )}
    </Box>
  );
}
