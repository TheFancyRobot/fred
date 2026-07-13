import { expect, mock, test } from 'bun:test';
import { Layer } from 'effect';
import { resolve } from 'node:path';
import type { ProviderModelDefaults } from '@fancyrobot/fred';
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
    credentialRequired: false,
    modelId: 'gpt-conformance',
    config: {
      apiKeyEnvVar: 'OPENAI_PROVIDER_CONFORMANCE_KEY',
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
    credentialRequired: false,
    modelId: 'claude-conformance',
    config: {
      apiKeyEnvVar: 'ANTHROPIC_PROVIDER_CONFORMANCE_KEY',
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
    credentialRequired: false,
    modelId: 'gemini-conformance',
    config: {
      apiKeyEnvVar: 'GOOGLE_PROVIDER_CONFORMANCE_KEY',
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
    credentialRequired: true,
    modelId: 'llama-conformance',
    config: {
      apiKeyEnvVar: 'GROQ_PROVIDER_CONFORMANCE_KEY',
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
    credentialRequired: false,
    modelId: 'openrouter/conformance',
    config: {
      apiKeyEnvVar: 'OPENROUTER_PROVIDER_CONFORMANCE_KEY',
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
    credentialRequired: true,
    modelId: 'MiniMax-Conformance',
    capabilities: [...MINIMAX_CAPABILITIES],
    config: {
      apiKeyEnvVar: 'MINIMAX_PROVIDER_CONFORMANCE_KEY',
      baseUrl: 'https://minimax.invalid/v1',
    },
    modelDefaults: MODEL_DEFAULTS,
    transport: { expectedUrl: 'https://minimax.invalid/v1/chat/completions' },
    classifyRetry: classifyMiniMaxHttpError,
  },
] satisfies readonly ProviderConformanceFixture[];

  defineProviderConformanceSuite(fixtures);
}
