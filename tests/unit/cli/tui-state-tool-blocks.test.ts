import { describe, expect, test } from 'bun:test';
import {
  addToolCall,
  completeToolCall,
  createInitialTuiState,
  ensureAssistantMessage,
  failToolCall,
  getToolBlocksForMessage,
  startStreaming,
  appendUserMessage,
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

  test('ensureAssistantMessage creates a placeholder turn once', () => {
    let state = createInitialTuiState();

    state = ensureAssistantMessage(state);
    state = ensureAssistantMessage(state);

    expect(state.transcript.messages).toHaveLength(1);
    expect(state.transcript.messages[0]).toEqual({ role: 'assistant', content: '' });
  });

  test('startStreaming clears previous tool blocks and anchors to the latest user message', () => {
    let state = createInitialTuiState();
    state = appendUserMessage(state, 'first');
    state = startStreaming(state);
    state = addToolCall(state, {
      messageId: 'm1',
      step: 0,
      toolCallId: 'tool-1',
      toolName: 'calculator',
      input: { expression: '1+1' },
      startedAt: 1,
    });

    state = appendUserMessage(state, 'second');
    state = startStreaming(state);

    expect(state.toolBlocks.groups).toHaveLength(0);
    expect(state.streaming.anchorUserMessageIndex).toBe(1);
  });

  test('getToolBlocksForMessage orders nested groups by step before flattening', () => {
    let state = createInitialTuiState();
    state = appendUserMessage(state, 'research prompt');
    state = startStreaming(state);

    state = addToolCall(state, {
      messageId: 'planner-msg',
      step: 3,
      toolCallId: 'planner-1',
      toolName: 'research-planner',
      input: {},
      startedAt: 20,
      depth: 3,
    });

    state = addToolCall(state, {
      messageId: 'swarm-msg',
      step: 2,
      toolCallId: 'swarm-1',
      toolName: 'run_research_swarm',
      input: {},
      startedAt: 10,
      depth: 2,
    });

    const blocks = getToolBlocksForMessage(state, 0);
    expect(blocks.map((block) => block.toolName)).toEqual([
      'run_research_swarm',
      'research-planner',
    ]);
  });
});
