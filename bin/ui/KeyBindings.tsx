import { Box, Text } from 'ink';
import React from 'react';

export function KeyBindings() {
  return (
    <Box paddingX={1}>
      <Text dimColor>[Q] quit   [C] clear log   [↑↓] scroll log</Text>
    </Box>
  );
}
