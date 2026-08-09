import { expect, mock, test } from 'bun:test';
import { Effect, Layer, Redacted } from 'effect';
import { resolve } from 'node:path';
import {
  makeProviderConnectionTestHook,
  testProviderConnectionDraft,
  type EffectProviderFactory,
  type ProviderConnectionCredentials,
  type ProviderConnectionDraft,
  type ProviderModelDefaults,
} from '@fancyrobot/fred';
import {
  defineProviderConformanceSuite,
  PROVIDER_CONFORMANCE_ISOLATION_ENV,
  type NativeRecorder,
  type ProviderConformanceFixture,
} from './harness';

interface MutableNativeRecorder extends NativeRecorder {
  readonly recordClient: (options: unknown) => void;
  readonly recordModel: (modelId: string, options: unknown) => void;
}

function createNativeRecorder(): MutableNativeRecorder {
  const clientOptions: Array<unknown> = [];
  const modelInvocations: Array<{ readonly modelId: string; readonly options: unknown }> = [];

  return {
    clientOptions,
    modelInvocations,
    recordClient: (options) => {
      clientOptions.push(options);
    },
    recordModel: (modelId, options) => {
      modelInvocations.push({ modelId, options });
    },
    reset: () => {
      clientOptions.length = 0;
      modelInvocations.length = 0;
    },
  };
}

function nativeModule(
  provider: string,
  recorder: MutableNativeRecorder,
  clientExport: string,
  languageModelExport: string,
): Record<string, unknown> {
  return {
    [clientExport]: {
      layer: (options: unknown) => {
        recorder.recordClient(options);
        return Layer.empty;
      },
    },
    [languageModelExport]: {
      model: (modelId: string, options?: unknown) => {
        recorder.recordModel(modelId, options);
        return { provider, modelId, options };
      },
    },
  };
}

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');

if (process.env[PROVIDER_CONFORMANCE_ISOLATION_ENV] !== '1') {
  test('runs provider conformance in an isolated Bun process', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        [PROVIDER_CONFORMANCE_ISOLATION_ENV]: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(`Isolated provider conformance failed:\n${stdout}\n${stderr}`);
    }
  }, 180_000);
} else {
  const openAiRecorder = createNativeRecorder();
  const anthropicRecorder = createNativeRecorder();
  const googleRecorder = createNativeRecorder();
  const openRouterRecorder = createNativeRecorder();

  mock.module('@effect/ai-openai', () => nativeModule(
    'openai',
    openAiRecorder,
    'OpenAiClient',
    'OpenAiLanguageModel',
  ));
  mock.module('@effect/ai-anthropic', () => nativeModule(
    'anthropic',
    anthropicRecorder,
    'AnthropicClient',
    'AnthropicLanguageModel',
  ));
  mock.module('@effect/ai-google', () => nativeModule(
    'google',
    googleRecorder,
    'GoogleClient',
    'GoogleLanguageModel',
  ));
  mock.module('@effect/ai-openrouter', () => nativeModule(
    'openrouter',
    openRouterRecorder,
    'OpenRouterClient',
    'OpenRouterLanguageModel',
  ));

  const [
    openAiModule,
    anthropicModule,
    googleModule,
    groqModule,
    openRouterModule,
    miniMaxModule,
    miniMaxConfig,
  ] = await Promise.all([
    import('../../../packages/provider-openai/src/index'),
    import('../../../packages/provider-anthropic/src/index'),
    import('../../../packages/provider-google/src/index'),
    import('../../../packages/provider-groq/src/index'),
    import('../../../packages/provider-openrouter/src/index'),
    import('../../../packages/provider-minimax/src/index'),
    import('../../../packages/provider-minimax/src/config'),
  ]);
  const {
    default: OpenAiDefault,
    OpenAiProviderFactory,
    openaiPack,
  } = openAiModule;
  const {
    default: AnthropicDefault,
    AnthropicProviderFactory,
    anthropicPack,
  } = anthropicModule;
  const {
    default: GoogleDefault,
    GoogleProviderFactory,
    googlePack,
  } = googleModule;
  const {
    default: GroqDefault,
    GroqProviderFactory,
    classifyHttpError: classifyGroqHttpError,
    groqPack,
  } = groqModule;
  const {
    default: OpenRouterDefault,
    OpenRouterProviderFactory,
    openrouterPack,
  } = openRouterModule;
  const {
    default: MiniMaxDefault,
    MINIMAX_CAPABILITIES,
    MiniMaxProviderFactory,
    minimaxPack,
  } = miniMaxModule;
  const { classifyHttpError: classifyMiniMaxHttpError } = miniMaxConfig;

  const PACKAGE_ROOT = resolve(import.meta.dir, '../../../packages');
  const MODEL_DEFAULTS = {
    temperature: 0.25,
    maxTokens: 321,
  } satisfies ProviderModelDefaults;
  const CREDENTIALS = { kind: 'api-key' as const, apiKey: Redacted.make('fred-provider-conformance-placeholder') };

  test('provider-owned connection probes authenticate bounded successful requests', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ readonly url: string; readonly headers: Headers }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response('{}', { status: 200 });
    };
    try {
      const hosted: readonly {
        factory: EffectProviderFactory;
        draft: ProviderConnectionDraft;
        credentials: ProviderConnectionCredentials;
        url: string;
        header: readonly [string, string];
      }[] = [
        { factory: OpenAiProviderFactory, draft: { label: 'openai', providerId: 'openai', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://api.openai.com/v1/models', header: ['authorization', 'Bearer fred-provider-conformance-placeholder'] },
        { factory: AnthropicProviderFactory, draft: { label: 'anthropic', providerId: 'anthropic', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://api.anthropic.com/v1/models', header: ['x-api-key', 'fred-provider-conformance-placeholder'] },
        { factory: GoogleProviderFactory, draft: { label: 'google', providerId: 'google', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://generativelanguage.googleapis.com/v1beta/models', header: ['x-goog-api-key', 'fred-provider-conformance-placeholder'] },
        { factory: GroqProviderFactory, draft: { label: 'groq', providerId: 'groq', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://api.groq.com/openai/v1/models', header: ['authorization', 'Bearer fred-provider-conformance-placeholder'] },
        { factory: OpenRouterProviderFactory, draft: { label: 'openrouter', providerId: 'openrouter', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://openrouter.ai/api/v1/key', header: ['authorization', 'Bearer fred-provider-conformance-placeholder'] },
        { factory: MiniMaxProviderFactory, draft: { label: 'minimax', providerId: 'minimax', auth: { kind: 'api-key' } }, credentials: CREDENTIALS, url: 'https://api.minimax.io/v1/models', header: ['authorization', 'Bearer fred-provider-conformance-placeholder'] },
      ];

      for (const fixture of hosted) {
        await Effect.runPromise(fixture.factory.connectionTest!.test(fixture.draft, fixture.credentials));
        const request = requests.at(-1)!;
        expect(request.url).toBe(fixture.url);
        expect(request.url).not.toContain('fred-provider-conformance-placeholder');
        expect(request.headers.get(fixture.header[0])).toBe(fixture.header[1]);
      }

      const local = [
        { factory: OpenAiProviderFactory, protocol: 'openai-compatible' as const, endpoint: 'http://127.0.0.1:11434/v1', expected: 'http://127.0.0.1:11434/v1/models' },
        { factory: AnthropicProviderFactory, protocol: 'anthropic-compatible' as const, endpoint: 'http://127.0.0.1:11435/v1', expected: 'http://127.0.0.1:11435/v1/models' },
      ];
      for (const fixture of local) {
        await Effect.runPromise(fixture.factory.connectionTest!.test({
          label: 'local',
          providerId: 'local-compatible',
          protocol: fixture.protocol,
          endpoint: fixture.endpoint,
          auth: { kind: 'none' },
        }, { kind: 'none' }));
        expect(requests.at(-1)!.url).toBe(fixture.expected);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('connection probes reject auth mismatches, unsuccessful status, and timeout without secrets', async () => {
    const mismatch = await Effect.runPromise(Effect.flip(testProviderConnectionDraft(
      { label: 'work', providerId: 'openai', auth: { kind: 'none' } },
      CREDENTIALS,
    )));
    expect(mismatch).toMatchObject({
      _tag: 'ProviderConnectionTestError',
      reason: 'configuration',
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(null, { status: 401 });
      const rejected = await Effect.runPromise(Effect.flip(OpenAiProviderFactory.connectionTest!.test(
        { label: 'work', providerId: 'openai', auth: { kind: 'api-key' } },
        CREDENTIALS,
      )));
      expect(rejected).toMatchObject({ reason: 'authentication', statusCode: 401 });

      globalThis.fetch = () => new Promise<Response>(() => undefined);
      const timed = makeProviderConnectionTestHook({
        providerId: 'timeout-fixture',
        timeoutMs: 1,
        request: () => ({ url: 'https://timeout.invalid/models' }),
      });
      const timeout = await Effect.runPromise(Effect.flip(timed.test(
        { label: 'timeout', providerId: 'timeout-fixture', auth: { kind: 'none' } },
        { kind: 'none' },
      )));
      expect(timeout).toMatchObject({ reason: 'timeout' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('connection probes cancel success and rejected response bodies', async () => {
    const originalFetch = globalThis.fetch;
    const cancellations: number[] = [];
    let request = 0;
    globalThis.fetch = async () => {
      const current = ++request;
      return new Response(new ReadableStream({
        cancel: () => {
          cancellations.push(current);
          if (current === 2) return Promise.reject(new Error('cleanup failed'));
        },
      }), { status: current === 1 ? 200 : 401 });
    };
    try {
      await Effect.runPromise(OpenAiProviderFactory.connectionTest!.test(
        { label: 'work', providerId: 'openai', auth: { kind: 'api-key' } },
        CREDENTIALS,
      ));
      const rejected = await Effect.runPromise(Effect.flip(OpenAiProviderFactory.connectionTest!.test(
        { label: 'work', providerId: 'openai', auth: { kind: 'api-key' } },
        CREDENTIALS,
      )));
      expect(rejected).toMatchObject({ reason: 'authentication', statusCode: 401 });
      expect(cancellations).toEqual([1, 2]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAI and Anthropic connectors load every local-compatible auth mode', async () => {
    const cases = [
      { factory: OpenAiProviderFactory, recorder: openAiRecorder, endpoint: 'http://127.0.0.1:11434/v1' },
      { factory: AnthropicProviderFactory, recorder: anthropicRecorder, endpoint: 'http://127.0.0.1:11435' },
    ] as const;
    const credentials = [
      { kind: 'none' as const },
      { kind: 'api-key' as const, apiKey: Redacted.make('local-key') },
      { kind: 'basic' as const, username: Redacted.make('local-user'), password: Redacted.make('local-password') },
    ];

    for (const fixture of cases) {
      for (const auth of credentials) {
        fixture.recorder.reset();
        await fixture.factory.load({ baseUrl: fixture.endpoint, credentials: auth });
        const options = fixture.recorder.clientOptions[0] as {
          apiKey?: unknown;
          apiUrl?: string;
          transformClient?: unknown;
        };
        expect(options.apiUrl).toBe(fixture.endpoint);
        expect(options.apiKey === undefined).toBe(auth.kind !== 'api-key');
        expect(options.transformClient).toBeFunction();
      }
    }
  });

  const fixtures = [
  {
    id: 'openai',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-openai'),
    packageName: '@fancyrobot/fred-openai',
    aliases: ['openai'],
    factory: OpenAiProviderFactory,
    module: {
      default: OpenAiDefault,
      factory: OpenAiProviderFactory,
      pack: openaiPack,
    },
    credentialEnvVar: 'OPENAI_PROVIDER_CONFORMANCE_KEY',
    modelId: 'gpt-conformance',
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://openai.invalid/v1',
    },
    modelDefaults: MODEL_DEFAULTS,
    native: {
      recorder: openAiRecorder,
      assertClientOptions: (options) => {
        expect(options).toMatchObject({
          apiKey: expect.anything(),
          apiUrl: 'https://openai.invalid/v1',
        });
      },
      assertModelOptions: (invocation) => {
        expect(invocation).toEqual({
          modelId: 'gpt-conformance',
          options: { temperature: 0.25, max_output_tokens: 321 },
        });
      },
    },
  },
  {
    id: 'anthropic',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-anthropic'),
    packageName: '@fancyrobot/fred-anthropic',
    aliases: ['anthropic'],
    factory: AnthropicProviderFactory,
    module: {
      default: AnthropicDefault,
      factory: AnthropicProviderFactory,
      pack: anthropicPack,
    },
    credentialEnvVar: 'ANTHROPIC_PROVIDER_CONFORMANCE_KEY',
    modelId: 'claude-conformance',
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://anthropic.invalid/v1',
    },
    modelDefaults: MODEL_DEFAULTS,
    native: {
      recorder: anthropicRecorder,
      assertClientOptions: (options) => {
        expect(options).toMatchObject({
          apiKey: expect.anything(),
          apiUrl: 'https://anthropic.invalid/v1',
        });
      },
      assertModelOptions: (invocation) => {
        expect(invocation).toEqual({
          modelId: 'claude-conformance',
          options: { temperature: 0.25, max_tokens: 321 },
        });
      },
    },
  },
  {
    id: 'google',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-google'),
    packageName: '@fancyrobot/fred-google',
    aliases: ['google', 'gemini'],
    factory: GoogleProviderFactory,
    module: {
      default: GoogleDefault,
      factory: GoogleProviderFactory,
      pack: googlePack,
    },
    credentialEnvVar: 'GOOGLE_PROVIDER_CONFORMANCE_KEY',
    modelId: 'gemini-conformance',
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://google.invalid/v1',
      headers: { 'X-Conformance': 'enabled' },
    },
    modelDefaults: MODEL_DEFAULTS,
    native: {
      recorder: googleRecorder,
      assertClientOptions: (options) => {
        expect(options).toMatchObject({
          apiKey: expect.anything(),
          apiUrl: 'https://google.invalid/v1',
          transformClient: expect.any(Function),
        });
      },
      assertModelOptions: (invocation) => {
        expect(invocation).toEqual({
          modelId: 'gemini-conformance',
          options: {
            generationConfig: { temperature: 0.25, maxOutputTokens: 321 },
          },
        });
      },
    },
  },
  {
    id: 'groq',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-groq'),
    packageName: '@fancyrobot/fred-groq',
    aliases: ['groq'],
    factory: GroqProviderFactory,
    module: {
      default: GroqDefault,
      factory: GroqProviderFactory,
      pack: groqPack,
    },
    credentialEnvVar: 'GROQ_PROVIDER_CONFORMANCE_KEY',
    modelId: 'llama-conformance',
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://groq.invalid/v1',
    },
    modelDefaults: MODEL_DEFAULTS,
    transport: { expectedUrl: 'https://groq.invalid/v1/chat/completions' },
    classifyRetry: classifyGroqHttpError,
  },
  {
    id: 'openrouter',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-openrouter'),
    packageName: '@fancyrobot/fred-openrouter',
    aliases: ['openrouter'],
    factory: OpenRouterProviderFactory,
    module: {
      default: OpenRouterDefault,
      factory: OpenRouterProviderFactory,
      pack: openrouterPack,
    },
    credentialEnvVar: 'OPENROUTER_PROVIDER_CONFORMANCE_KEY',
    modelId: 'openrouter/conformance',
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://openrouter.invalid/v1',
      headers: {
        'HTTP-Referer': 'https://fred.invalid',
        'X-Title': 'Fred Conformance',
      },
    },
    modelDefaults: MODEL_DEFAULTS,
    native: {
      recorder: openRouterRecorder,
      assertClientOptions: (options) => {
        expect(options).toMatchObject({
          apiKey: expect.anything(),
          apiUrl: 'https://openrouter.invalid/v1',
          referrer: 'https://fred.invalid',
          title: 'Fred Conformance',
        });
      },
      assertModelOptions: (invocation) => {
        expect(invocation).toEqual({
          modelId: 'openrouter/conformance',
          options: { temperature: 0.25, max_tokens: 321 },
        });
      },
    },
  },
  {
    id: 'minimax',
    packageDirectory: resolve(PACKAGE_ROOT, 'provider-minimax'),
    packageName: '@fancyrobot/fred-minimax',
    aliases: ['minimax'],
    factory: MiniMaxProviderFactory,
    module: {
      default: MiniMaxDefault,
      factory: MiniMaxProviderFactory,
      pack: minimaxPack,
    },
    credentialEnvVar: 'MINIMAX_PROVIDER_CONFORMANCE_KEY',
    modelId: 'MiniMax-Conformance',
    capabilities: [...MINIMAX_CAPABILITIES],
    config: {
      credentials: CREDENTIALS,
      baseUrl: 'https://minimax.invalid/v1',
    },
    modelDefaults: MODEL_DEFAULTS,
    transport: { expectedUrl: 'https://minimax.invalid/v1/chat/completions' },
    classifyRetry: classifyMiniMaxHttpError,
  },
] satisfies readonly ProviderConformanceFixture[];

  defineProviderConformanceSuite(fixtures);
}
