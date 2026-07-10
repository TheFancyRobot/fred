import { describe, expect, test } from 'bun:test';
import {
  createStreamIdGenerator,
  generateSyntheticStreamEvents,
} from '../../../../packages/core/src/message-processor/stream-events';

describe('synthetic message processor stream events', () => {
  test('preserves decoded structured output in the run-end event', () => {
    const events = generateSyntheticStreamEvents({
      conversationId: 'typed-session',
      message: '{"question":"hello"}',
      previousMessages: [],
      response: {
        content: '{"answer":"hi"}',
        output: { answer: 'hi' },
      },
    }, createStreamIdGenerator());

    const runEnd = events.find((event) => event.type === 'run-end');

    expect(runEnd?.type).toBe('run-end');
    if (runEnd?.type === 'run-end') {
      expect(runEnd.result.output).toEqual({ answer: 'hi' });
    }
  });

  test('does not add an output property for ordinary text agents', () => {
    const events = generateSyntheticStreamEvents({
      conversationId: 'text-session',
      message: 'hello',
      previousMessages: [],
      response: { content: 'hi' },
    }, createStreamIdGenerator());

    const runEnd = events.find((event) => event.type === 'run-end');

    expect(runEnd?.type).toBe('run-end');
    if (runEnd?.type === 'run-end') {
      expect('output' in runEnd.result).toBe(false);
    }
  });
});
