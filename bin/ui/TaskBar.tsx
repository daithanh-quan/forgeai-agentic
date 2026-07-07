import { Box, Text } from 'ink';
import React from 'react';

export function TaskBar({ task }: { task: string | null }) {
  return (
    <Box paddingX={2}>
      {task ? (
        <Text>
          <Text dimColor>{'> '}</Text>
          <Text>"{task}"</Text>
        </Text>
      ) : (
        <Text dimColor>Waiting for task...</Text>
      )}
    </Box>
  );
}
