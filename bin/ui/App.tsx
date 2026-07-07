import { Box, useApp, useInput } from 'ink';
import React, { useEffect, useReducer, useState } from 'react';
import { ActivityLog } from './ActivityLog.js';
import { AgentPanel } from './AgentPanel.js';
import { CheckBar } from './CheckBar.js';
import { Header } from './Header.js';
import { KeyBindings } from './KeyBindings.js';
import { TaskBar } from './TaskBar.js';
import { createPipeReader, getPipePath } from './pipe.js';
import { initialState, reducer } from './reducer.js';
import type { ForgeEvent } from './types.js';

export default function App() {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    const pipePath = getPipePath();
    const cleanup = createPipeReader(pipePath, (line) => {
      let event: ForgeEvent;
      try {
        event = JSON.parse(line) as ForgeEvent;
      } catch {
        event = { type: '_unknown', ts: Date.now() / 1000, raw: line };
      }
      dispatch(event);
    });
    return cleanup;
  }, []);

  useInput((_input, key) => {
    const input = _input.toLowerCase();
    if (input === 'q') {
      exit();
      return;
    }
    if (input === 'c') {
      dispatch({ type: '_clear_log', ts: Date.now() / 1000 });
      return;
    }
    if (key.upArrow) setScrollOffset((o) => Math.min(o + 1, 0));
    if (key.downArrow) setScrollOffset((o) => Math.max(o - 1, -(state.logs.length)));
  });

  return (
    <Box flexDirection="column">
      <Header connected={state.connected} />
      <TaskBar task={state.task} />
      <Box flexDirection="row">
        <AgentPanel agents={state.agents} />
        <ActivityLog logs={state.logs} scrollOffset={scrollOffset} />
      </Box>
      <CheckBar checks={state.checks} />
      <KeyBindings />
    </Box>
  );
}
