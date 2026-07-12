import { afterEach, describe, expect, test } from 'bun:test';
import OpenAI from 'openai';
import { Effect, Stream } from 'effect';
import { createFred, type FredClient, type StreamEvent } from '@fancyrobot/fred';
import {
  MessageProcessorService,
  type FredServices,
  type MessageProcessorService as MessageProcessorServiceApi,
} from '@fancyrobot/fred/effect';
import { withHttp, type FredWithHttp } from '../../../packages/fred-http/src';

const clients: FredWithHttp[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

const response = { content: 'hello from fred' };

const streamEvents = (): ReadonlyArray<StreamEvent> => {
  const base = { runId: 'sdk-run', emittedAt: 1, threadId: 'sdk-thread' };
  return [
    { ...base, type: 'message-start', sequence: 1, messageId: 'sdk-message', step: 0, role: 'assistant' },
    { ...base, type: 'token', sequence: 2, messageId: 'sdk-message', step: 0, delta: 'hello ', accumulated: 'hello ' },
    { ...base, type: 'token', sequence: 3, messageId: 'sdk-message', step: 0, delta: 'from fred', accumulated: 'hello from fred' },
    { ...base, type: 'message-end', sequence: 4, messageId: 'sdk-message', step: 0, finishedAt: 2, finishReason: 'stop' },
    { ...base, type: 'run-end', sequence: 5, finishedAt: 3, durationMs: 2, result: response },
  ];
};

const deterministicProcessor: MessageProcessorServiceApi = {
  routeMessage: () => Effect.dieMessage('routeMessage is not used by this fixture'),
  processMessage: () => Effect.succeed(response),
  processChatMessage: () => Effect.succeed(response),
  streamMessage: () => Stream.fromIterable(streamEvents()),
  updateConfig: () => Effect.void,
  getConfig: () => Effect.succeed({ memoryDefaults: {} }),
};

const withDeterministicProcessor = (client: FredClient): FredClient => ({
  ...client,
  effects: {
    run: <A, E>(effect: Effect.Effect<A, E, FredServices>) =>
      client.effects.run(
        Effect.provideService(effect, MessageProcessorService, deterministicProcessor),
      ),
  },
});

describe('OpenAI npm client compatibility', () => {
  test('supports non-streaming, streaming, and X-Session-Id continuation without external calls', async () => {
    const core = await createFred();
    const fred = withHttp(withDeterministicProcessor(core), {
      security: { authToken: 'sdk-token' },
    });
    clients.push(fred);
    const handle = await fred.server.listen();
    const sdk = new OpenAI({
      apiKey: 'sdk-token',
      baseURL: `${handle.url}/v1`,
      maxRetries: 0,
    });

    const first = await sdk.chat.completions.create({
      model: 'fred-test',
      messages: [{ role: 'user', content: 'hello' }],
    }).withResponse();
    expect(first.data.choices[0]?.message.content).toBe('hello from fred');
    const sessionId = first.response.headers.get('x-session-id');
    expect(sessionId).toBeTruthy();

    const continued = await sdk.chat.completions.create({
      model: 'fred-test',
      messages: [{ role: 'user', content: 'again' }],
    }, {
      headers: { 'X-Session-Id': sessionId ?? '' },
    }).withResponse();
    expect(continued.response.headers.get('x-session-id')).toBe(sessionId);

    const stream = await sdk.chat.completions.create({
      model: 'fred-test',
      messages: [{ role: 'user', content: 'stream' }],
      stream: true,
    }, {
      headers: { 'X-Session-Id': sessionId ?? '' },
    });
    let content = '';
    for await (const chunk of stream) content += chunk.choices[0]?.delta.content ?? '';
    expect(content).toBe('hello from fred');
  });
});
