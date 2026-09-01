import { expect, test } from 'bun:test';
import * as LanguageModel from '@effect/ai/LanguageModel';
import { FetchHttpClient } from '@effect/platform';
import { Effect, Either, Layer, Redacted, Stream } from 'effect';
import type { ProviderConfig, ProviderDefinition } from '@fancyrobot/fred';
import {
  InvalidOpenAiCompatibleProviderConfigError,
  OpenAiProviderFactory,
  createOpenAiCompatibleProviderFactory,
  loadOpenAiCompatibleRuntime,
} from '../../../packages/provider-openai/src/index';

const BASE_URL = 'http://127.0.0.1:11434/v1';
const MODEL_ID = 'local/test';

interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** Deterministic fetch fixture that captures the actual Request the adapter produces. */
const captureRequests = () => {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = (await request.json()) as Record<string, unknown>;
    requests.push({ url: request.url, headers, body });
    if (body.stream === true) {
      return new Response([
        `data: {"id":"completion-1","created":0,"model":"${MODEL_ID}","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}`,
        `data: {"id":"completion-1","created":0,"model":"${MODEL_ID}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`,
        'data: [DONE]',
        '',
      ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json({
      id: 'completion-structured',
      object: 'chat.completion',
      created: 0,
      model: MODEL_ID,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'OK' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

/** Runs the runtime and fails loudly if it succeeds where a typed error was expected. */
const expectConfigError = async (config: ProviderConfig): Promise<InvalidOpenAiCompatibleProviderConfigError> => {
  const either = await Effect.runPromise(loadOpenAiCompatibleRuntime(config).pipe(Effect.either));
  if (Either.isRight(either)) {
    throw new Error(`expected InvalidOpenAiCompatibleProviderConfigError, got definition id "${either.right.id}"`);
  }
  expect(either.left).toBeInstanceOf(InvalidOpenAiCompatibleProviderConfigError);
  return either.left;
};

/** Guards that the validation path performs no network I/O. */
const withFetchGuard = async (run: () => Promise<void>) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network I/O attempted during config validation');
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

/** Runs a single non-streaming text generation through a loaded definition. */
const runText = async (definition: ProviderDefinition, modelId = MODEL_ID) => {
  const model = await Effect.runPromise(definition.getModel(modelId));
  const modelWithClient = Layer.provide(
    model,
    definition.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  );
  return Effect.runPromise(
    LanguageModel.generateText({ prompt: 'Reply with exactly OK.' }).pipe(Effect.provide(modelWithClient)),
  );
};

test('factory identity: id and aliases match, aliases is a defensive copy', () => {
  const aliases = ['alias-a', 'alias-b'];
  const factory = createOpenAiCompatibleProviderFactory({ id: 'myprovider', aliases });
  expect(factory.id).toBe('myprovider');
  expect(factory.aliases).toEqual(['alias-a', 'alias-b']);
  expect(factory.aliases).not.toBe(aliases);
  aliases.push('alias-c');
  expect(factory.aliases).toEqual(['alias-a', 'alias-b']);
});

test('factory defaults aliases to an empty array and rejects an empty id', () => {
  expect(createOpenAiCompatibleProviderFactory({ id: 'myprovider' }).aliases).toEqual([]);
  expect(() => createOpenAiCompatibleProviderFactory({ id: '' })).toThrow();
});

test('factory declares openai-compatible protocol capabilities under its own id', () => {
  const factory = createOpenAiCompatibleProviderFactory({ id: 'myprovider' });
  expect(factory.connectionCapabilities).toEqual({
    providerId: 'myprovider',
    auth: ['api-key', 'basic', 'none'],
    login: ['manual-secret'],
    protocols: ['openai-compatible'],
  });
});

test('two generated factories coexist without mutating the built-in registry', () => {
  const alpha = createOpenAiCompatibleProviderFactory({ id: 'alpha', aliases: ['a1'] });
  const beta = createOpenAiCompatibleProviderFactory({ id: 'beta', aliases: ['b1'] });
  expect(alpha.id).not.toBe(beta.id);
  expect(alpha.aliases).toEqual(['a1']);
  expect(beta.aliases).toEqual(['b1']);
  expect(alpha.aliases).not.toBe(beta.aliases);
  // Construction is side-effect-free: the built-in pack is untouched.
  expect(OpenAiProviderFactory.id).toBe('openai');
  expect(OpenAiProviderFactory.aliases).toEqual(['openai']);
});

test('missing baseUrl fails with missing-base-url before fetch', async () => {
  await withFetchGuard(async () => {
    const error = await expectConfigError({ credentials: { kind: 'none' } });
    expect(error.reason).toBe('missing-base-url');
  });
});

test('invalid baseUrl shapes fail with typed reasons before fetch', async () => {
  const cases: Array<[string, string]> = [
    ['/v1', 'invalid-url'],
    ['not an url', 'invalid-url'],
    ['ftp://127.0.0.1:11434/v1', 'unsupported-scheme'],
    ['ws://127.0.0.1:11434/v1', 'unsupported-scheme'],
    ['http://user:pass@127.0.0.1:11434/v1', 'userinfo'],
    [`${BASE_URL}?api_key=query-secret`, 'query-string'],
    [`${BASE_URL}#section`, 'fragment'],
  ];
  for (const [baseUrl, reason] of cases) {
    await withFetchGuard(async () => {
      const error = await expectConfigError({ baseUrl, credentials: { kind: 'none' } });
      expect(error.reason).toBe(reason);
    });
  }
});

test('oauth2-bearer credentials are rejected as unsupported', async () => {
  await withFetchGuard(async () => {
    const error = await expectConfigError({
      baseUrl: BASE_URL,
      credentials: {
        kind: 'oauth2-bearer',
        accessToken: Redacted.make('bearer-secret-token'),
      },
    });
    expect(error.reason).toBe('unsupported-credential-kind');
  });
});

test('Authorization entries in config.headers are rejected case-insensitively', async () => {
  await withFetchGuard(async () => {
    const exact = await expectConfigError({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
      headers: { Authorization: 'Bearer header-secret' },
    });
    expect(exact.reason).toBe('authorization-header');
    const lowered = await expectConfigError({
      baseUrl: BASE_URL,
      credentials: { kind: 'api-key', apiKey: Redacted.make('key-secret') },
      headers: { authorization: 'Bearer header-secret' },
    });
    expect(lowered.reason).toBe('authorization-header');
  });
});

test('errors never include credentials or sensitive URL data', async () => {
  const cases = await Promise.all([
    expectConfigError({ baseUrl: 'http://user:userinfo-secret@127.0.0.1:11434/v1', credentials: { kind: 'none' } }),
    expectConfigError({ baseUrl: `${BASE_URL}?token=query-secret`, credentials: { kind: 'none' } }),
    expectConfigError({
      baseUrl: BASE_URL,
      credentials: { kind: 'oauth2-bearer', accessToken: Redacted.make('bearer-secret-token') },
    }),
    expectConfigError({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
      headers: { Authorization: 'Bearer header-secret' },
    }),
  ]);
  const secrets = ['userinfo-secret', 'query-secret', 'bearer-secret-token', 'header-secret'];
  for (const error of cases) {
    for (const secret of secrets) {
      expect(error.message).not.toContain(secret);
    }
  }
});

test('auth none produces a valid definition with no authorization header', async () => {
  const config: ProviderConfig = {
    baseUrl: BASE_URL,
    credentials: { kind: 'none' },
    aliases: ['compatible-alias'],
  };
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime(config));
    expect(definition.id).toBe('openai-compatible');
    expect(definition.aliases).toEqual(['compatible-alias']);
    expect(definition.config).toBe(config);
    expect(definition.layer).toBeDefined();
    const response = await runText(definition);
    expect(response.text).toBe('OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['authorization']).toBeUndefined();
  } finally {
    restore();
  }
});

test('api-key credentials send the credential-derived Bearer authorization', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: { kind: 'api-key', apiKey: Redacted.make('local-api-key') },
    }));
    await runText(definition);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['authorization']).toBe('Bearer local-api-key');
  } finally {
    restore();
  }
});

test('basic credentials send the credential-derived Basic authorization', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: {
        kind: 'basic',
        username: Redacted.make('local-user'),
        password: Redacted.make('local-password'),
      },
    }));
    await runText(definition);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['authorization']).toBe(`Basic ${btoa('local-user:local-password')}`);
  } finally {
    restore();
  }
});

test('custom non-auth headers are preserved on the request', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
      headers: { 'X-Fred-Probe': 'compatible-runtime', 'x-custom-source': 'unit-test' },
    }));
    await runText(definition);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['x-fred-probe']).toBe('compatible-runtime');
    expect(requests[0].headers['x-custom-source']).toBe('unit-test');
  } finally {
    restore();
  }
});

test('base URLs resolve to exactly one /chat/completions suffix', async () => {
  const cases: Array<[string, string]> = [
    [BASE_URL, 'http://127.0.0.1:11434/v1/chat/completions'],
    [`${BASE_URL}/`, 'http://127.0.0.1:11434/v1/chat/completions'],
    ['https://compatible.example.com/api/v3', 'https://compatible.example.com/api/v3/chat/completions'],
    ['https://compatible.example.com', 'https://compatible.example.com/chat/completions'],
  ];
  for (const [baseUrl, expected] of cases) {
    const { requests, restore } = captureRequests();
    try {
      const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({ baseUrl, credentials: { kind: 'none' } }));
      await runText(definition);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(expected);
    } finally {
      restore();
    }
  }
});

test('model IDs pass through unchanged and defaults map to Chat Completions fields', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
    }));
    const model = await Effect.runPromise(definition.getModel(MODEL_ID, { temperature: 0.37, maxTokens: 250 }));
    const modelWithClient = Layer.provide(
      model,
      definition.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    );
    const response = await Effect.runPromise(
      LanguageModel.generateText({ prompt: 'Reply with exactly OK.' }).pipe(Effect.provide(modelWithClient)),
    );
    expect(response.text).toBe('OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].body.model).toBe(MODEL_ID);
    expect(requests[0].body.temperature).toBe(0.37);
    expect(requests[0].body.max_tokens).toBe(250);
    expect(requests[0].body.max_output_tokens).toBeUndefined();
  } finally {
    restore();
  }
});

test('getModel without defaults omits Chat Completions sampling fields', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
    }));
    await runText(definition);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.temperature).toBeUndefined();
    expect(requests[0].body.max_tokens).toBeUndefined();
  } finally {
    restore();
  }
});

test('streaming decodes SSE incrementally through a single request', async () => {
  const { requests, restore } = captureRequests();
  try {
    const definition = await Effect.runPromise(loadOpenAiCompatibleRuntime({
      baseUrl: BASE_URL,
      credentials: { kind: 'none' },
    }));
    const model = await Effect.runPromise(definition.getModel(MODEL_ID));
    const modelWithClient = Layer.provide(
      model,
      definition.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    );
    const deltas: string[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        LanguageModel.streamText({ prompt: 'Reply with exactly OK.' }),
        (part) => {
          if (part.type === 'text-delta') {
            deltas.push(part.delta);
          }
          return Effect.void;
        },
      ).pipe(Effect.provide(modelWithClient)),
    );
    expect(deltas.join('')).toBe('OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].body.stream).toBe(true);
  } finally {
    restore();
  }
});

test('factory load resolves a working Chat Completions runtime', async () => {
  const { requests, restore } = captureRequests();
  const factory = createOpenAiCompatibleProviderFactory({ id: 'probe' });
  try {
    const runtime = await factory.load({ baseUrl: BASE_URL, credentials: { kind: 'none' } });
    const model = await Effect.runPromise(runtime.getModel(MODEL_ID));
    const modelWithClient = Layer.provide(
      model,
      runtime.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    );
    const response = await Effect.runPromise(
      LanguageModel.generateText({ prompt: 'Reply with exactly OK.' }).pipe(Effect.provide(modelWithClient)),
    );
    expect(response.text).toBe('OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
  } finally {
    restore();
  }
});

test('factory load rejects invalid config with the typed error before fetch', async () => {
  const factory = createOpenAiCompatibleProviderFactory({ id: 'probe' });
  await withFetchGuard(async () => {
    const error = await factory.load({ credentials: { kind: 'none' } }).then(
      () => {
        throw new Error('expected factory load to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InvalidOpenAiCompatibleProviderConfigError);
    expect((error as InvalidOpenAiCompatibleProviderConfigError).reason).toBe('missing-base-url');
  });
});
