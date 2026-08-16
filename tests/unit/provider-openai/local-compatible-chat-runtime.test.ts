import { expect, test } from 'bun:test';
import * as LanguageModel from '@effect/ai/LanguageModel';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Layer, Schema, Stream } from 'effect';
import { OpenAiProviderFactory } from '../../../packages/provider-openai/src/index';

test('local OpenAI-compatible connections stream through Chat Completions', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json() as Record<string, unknown>;
    requests.push({ url: request.url, body });
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
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    url: 'http://127.0.0.1:11434/v1/chat/completions',
    body: {
      model: 'local/test',
      response_format: { type: 'json_schema' },
    },
  });
  expect(requests[1]).toMatchObject({
    url: 'http://127.0.0.1:11434/v1/chat/completions',
    body: { model: 'local/test', stream: true },
  });
});
