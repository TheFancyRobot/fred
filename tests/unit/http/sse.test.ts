import { describe, expect, test } from 'bun:test';
import { toOpenAIStream, type StreamEvent } from '@fancyrobot/fred';
import { Chunk, Effect, Exit, Stream } from 'effect';
import { encodeOpenAiSse } from '../../../packages/fred-http/src/handlers/sse';

const decoder = new TextDecoder();

describe('OpenAI SSE', () => {
  test('emits chunk objects, a finish chunk, and exactly one DONE record', async () => {
    const base = { runId: 'run-1', emittedAt: 1, threadId: 'thread-1' };
    const events: ReadonlyArray<StreamEvent> = [
      { ...base, type: 'message-start', sequence: 1, messageId: 'message-1', step: 0, role: 'assistant' },
      { ...base, type: 'token', sequence: 2, messageId: 'message-1', step: 0, delta: 'hi', accumulated: 'hi' },
      { ...base, type: 'message-end', sequence: 3, messageId: 'message-1', step: 0, finishedAt: 2, finishReason: 'stop' },
      { ...base, type: 'run-end', sequence: 4, finishedAt: 3, durationMs: 2, result: { content: 'hi' } },
    ];

    const bytes = await Effect.runPromise(
      encodeOpenAiSse(toOpenAIStream(Stream.fromIterable(events), {
        model: 'test-model',
        now: () => 1_000,
      })).pipe(Stream.runCollect),
    );
    const records = Chunk.toReadonlyArray(bytes).map((part) => decoder.decode(part));
    const jsonRecords = records.slice(0, -1).map((record) =>
      JSON.parse(record.slice('data: '.length).trim()),
    );

    expect(jsonRecords.every((record) => record.object === 'chat.completion.chunk')).toBe(true);
    expect(jsonRecords.at(-1)?.choices[0].finish_reason).toBe('stop');
    expect(records.filter((record) => record === 'data: [DONE]\n\n')).toHaveLength(1);
  });

  test('does not append DONE after a mid-stream failure', async () => {
    const records: string[] = [];
    const stream = encodeOpenAiSse(
      Stream.concat(
        Stream.succeed({ object: 'chat.completion.chunk' as const, id: 'first' }),
        Stream.fail(new Error('mid-stream')),
      ),
    );
    const exit = await Effect.runPromiseExit(
      stream.pipe(Stream.runForEach((part) => Effect.sync(() => records.push(decoder.decode(part))))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(records).toEqual(['data: {"object":"chat.completion.chunk","id":"first"}\n\n']);
  });
});

