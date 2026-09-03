import { Box, Text } from 'ink';
import React from 'react';

export function TaskBar({ task, pipePath }: { task: string | null; pipePath: string }) {
  return (
    <Box paddingX={2} flexDirection="column">
      {task ? (
        <Text>
          <Text dimColor>{'> '}</Text>
          <Text>"{task}"</Text>
        </Text>
      ) : (
        <>
          <Text color="green">Monitor ready.</Text>
          <Text dimColor>Listening on {pipePath}. Start a route/check or use --emit in another terminal.</Text>
        </>
      )}
    </Box>
  );
}
