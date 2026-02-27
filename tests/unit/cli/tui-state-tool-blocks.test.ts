import { describe, expect, test } from 'bun:test';
import {
  addToolCall,
  completeToolCall,
  createInitialTuiState,
  failToolCall,
  toggleToolBlockExpand,
} from '../../../packages/cli/src/tui/state.js';

describe('TUI tool block state', () => {
  test('deduplicates addToolCall by toolCallId within a group', () => {
    let state = createInitialTuiState();

    state = addToolCall(state, {
      messageId: 'm1',
      step: 1,
      toolCallId: 'tool-1',
      toolName: 'calculator',
      input: { expression: '1+1' },
      startedAt: 1,
    });

    state = addToolCall(state, {
      messageId: 'm1',
      step: 1,
      toolCallId: 'tool-1',
      toolName: 'calculator',
      input: { expression: '2+2' },
      startedAt: 2,
    });

    const group = state.toolBlocks.groups[0];
    expect(group?.blocks).toHaveLength(1);
    expect(group?.blocks[0]?.input).toEqual({ expression: '2+2' });
    expect(group?.blocks[0]?.startedAt).toBe(2);
  });

  test('completeToolCall respects user expand override', () => {
    let state = createInitialTuiState();
    state = addToolCall(state, {
      messageId: 'm1',
      step: 1,
      toolCallId: 'tool-1',
      toolName: 'calculator',
      input: { expression: '1+1' },
      startedAt: 1,
    });

    state = toggleToolBlockExpand(state, 'tool-1');

    state = completeToolCall(state, {
      toolCallId: 'tool-1',
      output: '2',
      completedAt: 2,
      durationMs: 1,
    });

    expect(state.toolBlocks.groups[0]?.blocks[0]?.expanded).toBe(false);
    expect(state.toolBlocks.expandOverrides['tool-1']).toBe(false);
  });

  test('errored tool call keeps user collapse override', () => {
    let state = createInitialTuiState();
    state = addToolCall(state, {
      messageId: 'm1',
      step: 1,
      toolCallId: 'tool-1',
      toolName: 'calculator',
      input: { expression: '1+1' },
      startedAt: 1,
    });

    state = toggleToolBlockExpand(state, 'tool-1');

    state = failToolCall(state, {
      toolCallId: 'tool-1',
      error: { message: 'boom' },
      completedAt: 3,
      durationMs: 2,
    });

    expect(state.toolBlocks.groups[0]?.blocks[0]?.expanded).toBe(false);
    expect(state.toolBlocks.groups[0]?.blocks[0]?.status).toBe('errored');
  });
});
