import { Box, Text } from 'ink';
import React from 'react';
import type { LogEntry } from './types.js';

const LEVEL_COLOR: Record<string, string> = {
  info: 'white',
  warn: 'yellow',
  error: 'red',
};

const MAX_VISIBLE = 20;

export function ActivityLog({
  logs,
  scrollOffset,
}: {
  logs: LogEntry[];
  scrollOffset: number;
}) {
  const start = Math.max(0, logs.length - MAX_VISIBLE + scrollOffset);
  const visible = logs.slice(start, start + MAX_VISIBLE);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold underline>
        ACTIVITY LOG
      </Text>
      {visible.map((entry, i) => {
        const time = new Date(entry.ts * 1000).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return (
          <Text key={i} color={LEVEL_COLOR[entry.level] ?? 'white'}>
            <Text dimColor>{time}  </Text>
            {entry.text}
          </Text>
        );
      })}
    </Box>
  );
}
