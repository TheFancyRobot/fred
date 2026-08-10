import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as LanguageModel from '@effect/ai/LanguageModel';
import type {
  EffectProviderFactory,
  ProviderCapabilityKey,
  ProviderConfig,
  ProviderModelDefaults,
} from '@fancyrobot/fred';
import {
  createProviderDefinitionEffect,
  isProviderFactory,
  validatePackExports,
} from '../../../packages/core/src/platform/base';
import { hasCapability } from '../../../packages/core/src/platform/provider-capabilities';
import {
  getBuiltinPackIds,
  loadBuiltinPack,
  registerBuiltinPack,
} from '../../../packages/core/src/platform/packs/index';

export const PROVIDER_CONFORMANCE_ISOLATION_ENV = 'FRED_PROVIDER_CONFORMANCE_ISOLATED';

export interface NativeInvocation {
  readonly modelId: string;
  readonly options: unknown;
}

export interface NativeRecorder {
  readonly clientOptions: Array<unknown>;
  readonly modelInvocations: Array<NativeInvocation>;
  readonly reset: () => void;
}

export interface RetryClassification {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly category: string;
}

export interface ProviderModuleExports {
  readonly default: EffectProviderFactory;
  readonly factory: EffectProviderFactory;
  readonly pack: EffectProviderFactory;
}

export interface ProviderConformanceFixture {
  readonly id: string;
  readonly packageDirectory: string;
  readonly packageName: string;
  readonly aliases: readonly string[];
  readonly factory: EffectProviderFactory;
  readonly module: ProviderModuleExports;
  readonly credentialEnvVar: string;
  readonly modelId: string;
  readonly capabilities?: readonly ProviderCapabilityKey[];
  readonly config: ProviderConfig;
  readonly modelDefaults: ProviderModelDefaults;
  readonly native?: {
    readonly recorder: NativeRecorder;
    readonly assertClientOptions: (options: unknown) => void;
    readonly assertModelOptions: (invocation: NativeInvocation) => void;
  };
  readonly transport?: {
    readonly expectedUrl: string;
  };
  readonly classifyRetry?: (error: unknown) => RetryClassification;
}

const TEST_CREDENTIAL = 'fred-provider-conformance-placeholder';

function responseError(status: number): unknown {
  return {
    _tag: 'ResponseError',
    reason: 'StatusCode',
    response: { status },
    request: { method: 'POST', url: '/chat/completions' },
  };
}

function withCredential<A>(
  fixture: ProviderConformanceFixture,
  run: () => Promise<A>,
): Promise<A> {
  const previous = process.env[fixture.credentialEnvVar];
  process.env[fixture.credentialEnvVar] = TEST_CREDENTIAL;

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env[fixture.credentialEnvVar];
    } else {
      process.env[fixture.credentialEnvVar] = previous;
    }
  });
}

function withoutCredential<A>(
  fixture: ProviderConformanceFixture,
  run: () => Promise<A>,
): Promise<A> {
  const previous = process.env[fixture.credentialEnvVar];
  delete process.env[fixture.credentialEnvVar];

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env[fixture.credentialEnvVar];
    } else {
      process.env[fixture.credentialEnvVar] = previous;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function providerName(model: unknown): unknown {
  return isRecord(model) ? model.provider : undefined;
}

async function exerciseMockTransport(
  fixture: ProviderConformanceFixture,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ readonly url: string; readonly body: unknown }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    captured.push({
      url: request.url,
      body: text.length > 0 ? JSON.parse(text) : undefined,
    });

    return new Response(JSON.stringify({
      id: 'conformance-response',
      object: 'chat.completion',
      created: 0,
      model: fixture.modelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'deterministic response' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await withCredential(fixture, async () => {
      const loaded = await fixture.factory.load(fixture.config);
      const model = await Effect.runPromise(
        loaded.getModel(fixture.modelId, fixture.modelDefaults),
      );
      const generated = await Effect.runPromise(
        LanguageModel.generateText({ prompt: 'provider conformance' }).pipe(
          Effect.provide(model),
          Effect.provide(loaded.layer),
        ),
      );

      expect(generated.text).toBe('deterministic response');
      expect(providerName(model)).toBe(fixture.id);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(captured).toHaveLength(1);
  expect(captured[0]?.url).toBe(fixture.transport?.expectedUrl);
  expect(captured[0]?.body).toMatchObject({
    model: fixture.modelId,
    temperature: fixture.modelDefaults.temperature,
    max_tokens: fixture.modelDefaults.maxTokens,
  });
}

export function defineProviderConformanceSuite(
  fixtures: readonly ProviderConformanceFixture[],
): void {
  if (process.env[PROVIDER_CONFORMANCE_ISOLATION_ENV] !== '1') {
    throw new Error('Provider conformance must run through its isolated-process launcher');
  }

  describe('provider factory matrix', () => {
    test('uses unique canonical IDs and aliases', () => {
      const ids = fixtures.map((fixture) => fixture.id);
      expect(new Set(ids).size).toBe(ids.length);

      const aliases = fixtures.flatMap((fixture) => fixture.aliases);
      expect(new Set(aliases).size).toBe(aliases.length);
    });

    test('covers every registered provider package', () => {
      expect(fixtures.map((fixture) => fixture.id).sort()).toEqual(
        getBuiltinPackIds().sort(),
      );
    });

    test('loads every provider concurrently without network access', async () => {
      const previousValues = new Map<string, string | undefined>();
      for (const fixture of fixtures) {
        previousValues.set(fixture.credentialEnvVar, process.env[fixture.credentialEnvVar]);
        process.env[fixture.credentialEnvVar] = TEST_CREDENTIAL;
      }

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('Provider load/model construction attempted network access');
      };

      try {
        const results = await Promise.all(
          fixtures.map(async (fixture) => {
            const loaded = await fixture.factory.load(fixture.config);
            const model = await Effect.runPromise(
              loaded.getModel(fixture.modelId, fixture.modelDefaults),
            );
            return { fixture, loaded, model };
          }),
        );

        expect(results.map(({ fixture }) => fixture.id).sort()).toEqual(
          fixtures.map((fixture) => fixture.id).sort(),
        );
        for (const { loaded } of results) {
          expect(Layer.isLayer(loaded.layer)).toBe(true);
        }
      } finally {
        globalThis.fetch = originalFetch;
        for (const fixture of fixtures) {
          const previous = previousValues.get(fixture.credentialEnvVar);
          if (previous === undefined) {
            delete process.env[fixture.credentialEnvVar];
          } else {
            process.env[fixture.credentialEnvVar] = previous;
          }
        }
      }
    });
  });

  for (const fixture of fixtures) {
    describe(`${fixture.packageName} provider conformance`, () => {
      test('exports one factory identity and auto-registers IDs and aliases', () => {
        expect(fixture.module.default).toBe(fixture.factory);
        expect(fixture.module.factory).toBe(fixture.factory);
        expect(fixture.module.pack).toBe(fixture.factory);
        expect(loadBuiltinPack(fixture.id)).toBe(fixture.factory);
        for (const alias of fixture.aliases) {
          expect(loadBuiltinPack(alias)).toBe(fixture.factory);
        }
      });

      test('passes the shared factory schema', () => {
        expect(isProviderFactory(fixture.factory)).toBe(true);
        expect(validatePackExports(fixture.factory, fixture.packageName).id).toBe(fixture.id);
        expect(fixture.factory.aliases).toEqual(fixture.aliases);
      });

      test('duplicate registration is idempotent', () => {
        const before = getBuiltinPackIds().toSorted();
        registerBuiltinPack(fixture.factory);
        expect(getBuiltinPackIds().toSorted()).toEqual(before);
        expect(loadBuiltinPack(fixture.id)).toBe(fixture.factory);
      });

      test('loads a layer and returns a model Effect without network access', async () => {
        await withCredential(fixture, async () => {
          const originalFetch = globalThis.fetch;
          globalThis.fetch = async () => {
            throw new Error('Provider load/model construction attempted network access');
          };

          try {
            const loaded = await fixture.factory.load(fixture.config);
            expect(Layer.isLayer(loaded.layer)).toBe(true);
            expect(Effect.isEffect(loaded.getModel(fixture.modelId))).toBe(true);
            await Effect.runPromise(
              loaded.getModel(fixture.modelId, fixture.modelDefaults),
            );
          } finally {
            globalThis.fetch = originalFetch;
          }
        });
      });

      test('preserves capability declarations through the Effect definition', async () => {
        await withCredential(fixture, async () => {
          const definition = await Effect.runPromise(
            createProviderDefinitionEffect(fixture.factory, fixture.config),
          );

          expect(hasCapability(definition, 'language')).toBe(true);
          if (fixture.capabilities === undefined) {
            expect(definition.capabilities).toBeUndefined();
          } else {
            expect([...definition.capabilities ?? []].sort()).toEqual(
              [...fixture.capabilities].sort(),
            );
          }
          expect(definition.connectionCapabilities).toEqual(
            fixture.factory.connectionCapabilities,
          );
        });
      });

      test('does not depend on a credential environment through a typed Effect result', async () => {
        await withoutCredential(fixture, async () => {
          const exit = await Effect.runPromiseExit(
            createProviderDefinitionEffect(fixture.factory, fixture.config),
          );
          expect(exit._tag).toBe('Success');
        });
      });

      test('maps Fred configuration and model defaults', async () => {
        if (fixture.native !== undefined) {
          fixture.native.recorder.reset();
          await withCredential(fixture, async () => {
            const loaded = await fixture.factory.load(fixture.config);
            await Effect.runPromise(
              loaded.getModel(fixture.modelId, fixture.modelDefaults),
            );
          });

          expect(fixture.native.recorder.clientOptions).toHaveLength(1);
          expect(fixture.native.recorder.modelInvocations).toHaveLength(1);
          fixture.native.assertClientOptions(
            fixture.native.recorder.clientOptions[0],
          );
          fixture.native.assertModelOptions(
            fixture.native.recorder.modelInvocations[0]!,
          );
        } else {
          await exerciseMockTransport(fixture);
        }
      });

      test('keeps retry classification deterministic where the provider exposes it', () => {
        if (fixture.classifyRetry === undefined) {
          return;
        }

        expect(fixture.classifyRetry(responseError(429))).toMatchObject({
          retryable: true,
          statusCode: 429,
          category: 'rate-limit',
        });
        expect(fixture.classifyRetry(responseError(503))).toMatchObject({
          retryable: true,
          statusCode: 503,
          category: 'transient',
        });
        expect(fixture.classifyRetry(responseError(401))).toMatchObject({
          retryable: false,
          statusCode: 401,
          category: 'non-retryable',
        });
      });

      test('declares a publishable root package surface', async () => {
        const manifest = await Bun.file(
          `${fixture.packageDirectory}/package.json`,
        ).json();
        expect(manifest.name).toBe(fixture.packageName);
        expect(manifest.main).toBe('./dist/index.js');
        expect(manifest.types).toBe('./dist/index.d.ts');
        expect(manifest.exports?.['.']).toEqual({
          types: './dist/index.d.ts',
          bun: './src/index.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        });
        expect(manifest.files).toEqual(expect.arrayContaining(['src', 'dist']));
        expect(manifest.peerDependencies).toMatchObject({
          '@fancyrobot/fred': expect.any(String),
          '@effect/ai': expect.any(String),
          effect: expect.any(String),
        });
      });
    });
  }
}
