import { expect, test } from 'bun:test';
import * as LanguageModel from '@effect/ai/LanguageModel';
import { Prompt, Tool, Toolkit } from '@effect/ai';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Redacted, Schema, Stream } from 'effect';
import type { ProviderConfig } from '@fancyrobot/fred';
import { OpenAiProviderFactory } from '../../../packages/provider-openai/src/index';

test('local OpenAI-compatible connections stream through Chat Completions for every auth mode', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: Record<string, unknown>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = await request.json() as Record<string, unknown>;
    requests.push({ url: request.url, headers, body });
    const stream = body.stream === true;
    if (!stream) {
      return Response.json({
        id: 'completion-structured',
        object: 'chat.completion',
        created: 0,
        model: 'local/test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"ok":true}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return new Response([
      'data: {"id":"completion-1","created":0,"model":"local/test","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}',
      'data: {"id":"completion-1","created":0,"model":"local/test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
  };

  // BUG-0010: prove the credential-derived Authorization header on the wire
  // for every auth mode the saved-local protocol supports.
  const cases: Array<{
    readonly credentials: ProviderConfig['credentials'];
    readonly authorization: string | undefined;
  }> = [
    { credentials: { kind: 'none' }, authorization: undefined },
    {
      credentials: { kind: 'api-key', apiKey: Redacted.make('local-api-key') },
      authorization: 'Bearer local-api-key',
    },
    {
      credentials: {
        kind: 'basic',
        username: Redacted.make('local-user'),
        password: Redacted.make('local-password'),
      },
      authorization: `Basic ${btoa('local-user:local-password')}`,
    },
  ];

  try {
    for (const [index, { credentials, authorization }] of cases.entries()) {
      const runtime = await OpenAiProviderFactory.load({
        connectionProtocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        credentials,
      });
      const model = await Effect.runPromise(runtime.getModel('local/test'));
      const modelWithClient = Layer.provide(
        model,
        runtime.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      );
      const structured = await Effect.runPromise(
        LanguageModel.generateObject({
          prompt: 'Return {"ok":true}.',
          schema: Schema.Struct({ ok: Schema.Boolean }),
          objectName: 'probe',
        }).pipe(Effect.provide(modelWithClient)),
      );
      expect(structured.value).toEqual({ ok: true });
      await Effect.runPromise(Stream.runDrain(
        LanguageModel.streamText({ prompt: 'Reply with exactly OK.' }).pipe(
          Stream.provideLayer(modelWithClient),
        ),
      ));
      const [first, second] = requests.slice(-2);
      expect(requests).toHaveLength((index + 1) * 2);
      expect(first).toMatchObject({
        url: 'http://127.0.0.1:11434/v1/chat/completions',
        body: {
          model: 'local/test',
          response_format: { type: 'json_schema' },
        },
      });
      expect(first.headers['authorization']).toBe(authorization);
      expect(second).toMatchObject({
        url: 'http://127.0.0.1:11434/v1/chat/completions',
        body: { model: 'local/test', stream: true },
      });
      expect(second.headers['authorization']).toBe(authorization);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local OpenAI-compatible connections round-trip tool calls through Chat Completions', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json() as Record<string, unknown>;
    requests.push({ url: request.url, body });
    const messages = body.messages as Array<Record<string, unknown>>;
    // The follow-up request carries the echoed tool call and the tool result.
    if (messages.some((message) => message.role === 'tool')) {
      return Response.json({
        id: 'completion-final',
        object: 'chat.completion',
        created: 0,
        model: 'local/test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'It is sunny in Paris.' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return Response.json({
      id: 'completion-tools',
      object: 'chat.completion',
      created: 0,
      model: 'local/test',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"Paris"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  try {
    const runtime = await OpenAiProviderFactory.load({
      connectionProtocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      credentials: { kind: 'none' },
    });
    const model = await Effect.runPromise(runtime.getModel('local/test'));
    const modelWithClient = Layer.provide(
      model,
      runtime.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    );

    const GetWeather = Tool.make('get_weather', {
      description: 'Get the current weather for a location',
      parameters: { location: Schema.String },
      success: Schema.String,
    });
    const toolkit = Toolkit.make(GetWeather);
    const toolLayer = toolkit.toLayer({
      get_weather: (params) => Effect.succeed(`sunny in ${params.location}`),
    });
    const fullLayer = Layer.mergeAll(modelWithClient, toolLayer);

    // First request: the model answers with a tool call.
    const first = await Effect.runPromise(
      LanguageModel.generateText({
        prompt: 'What is the weather in Paris?',
        toolkit,
        disableToolCallResolution: true,
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(first.toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_1',
        name: 'get_weather',
        params: { location: 'Paris' },
      }),
    ]);

    // Second request: echo the tool call and send the tool result back.
    const followUp = Prompt.make([
      { role: 'user', content: 'What is the weather in Paris?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', id: 'call_1', name: 'get_weather', params: { location: 'Paris' }, providerExecuted: false },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', id: 'call_1', name: 'get_weather', isFailure: false, result: 'sunny', providerExecuted: false },
        ],
      },
    ]);
    const second = await Effect.runPromise(
      LanguageModel.generateText({
        prompt: followUp,
        toolkit,
        disableToolCallResolution: true,
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(second.text).toBe('It is sunny in Paris.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    url: 'http://127.0.0.1:11434/v1/chat/completions',
    body: { model: 'local/test' },
  });
  // The first request advertises the tool definitions.
  expect(requests[0].body.tools).toEqual([
    expect.objectContaining({
      type: 'function',
      function: expect.objectContaining({ name: 'get_weather' }),
    }),
  ]);
  const followUpMessages = requests[1].body.messages as Array<Record<string, unknown>>;
  expect(requests[1]).toMatchObject({
    url: 'http://127.0.0.1:11434/v1/chat/completions',
    body: { model: 'local/test' },
  });
  // The follow-up echoes the assistant tool call and carries the tool result.
  expect(followUpMessages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [
          expect.objectContaining({
            id: 'call_1',
            function: expect.objectContaining({
              name: 'get_weather',
              arguments: '{"location":"Paris"}',
            }),
          }),
        ],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_1',
        // The adapter JSON-stringifies tool results on the wire.
        content: JSON.stringify('sunny'),
      }),
    ]),
  );
});
