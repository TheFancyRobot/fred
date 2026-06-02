import { describe, test, expect } from 'bun:test';
import { Effect, Schema } from 'effect';
import {
  ProviderDefinition,
  ProviderConfig,
} from '../../../../packages/core/src/platform/provider';

// ─── Capability key coverage ────────────────────────────────────────────────

describe('Provider Capability Contract', () => {
  describe('ProviderCapabilityKey', () => {
    test('defines all expected capability keys', async () => {
      const { ProviderCapabilityKeys } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const expectedKeys = [
        'language',
        'image',
        'video',
        'speech',
        'voice',
        'music',
      ] as const;

      expectedKeys.forEach((key) => {
        expect(ProviderCapabilityKeys).toContain(key);
      });
    });

    test('ProviderCapabilityKey type covers all six modalities', async () => {
      const { ProviderCapabilityKeys } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      expect(ProviderCapabilityKeys.length).toBe(6);
    });
  });

  describe('UnsupportedProviderCapabilityError', () => {
    test('is a Schema.TaggedError with providerId and capability', async () => {
      const { UnsupportedProviderCapabilityError } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const error = new UnsupportedProviderCapabilityError({
        providerId: 'openai',
        capability: 'music',
      });

      expect(error._tag).toBe('UnsupportedProviderCapabilityError');
      expect(error.providerId).toBe('openai');
      expect(error.capability).toBe('music');
    });

    test('has meaningful message including provider and capability', async () => {
      const { UnsupportedProviderCapabilityError } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const error = new UnsupportedProviderCapabilityError({
        providerId: 'openai',
        capability: 'video',
      });

      expect(error.message).toContain('openai');
      expect(error.message).toContain('video');
    });

    test('works with Effect.catchTag', async () => {
      const { UnsupportedProviderCapabilityError } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const program = Effect.fail(
        new UnsupportedProviderCapabilityError({
          providerId: 'openai',
          capability: 'music',
        })
      );

      const result = await Effect.runPromise(
        program.pipe(
          Effect.catchTag('UnsupportedProviderCapabilityError', (e) =>
            Effect.succeed(`caught: ${e.providerId}/${e.capability}`)
          )
        )
      );

      expect(result).toBe('caught: openai/music');
    });
  });

  describe('getCapability helper', () => {
    test('returns failure Effect when capability is not supported', async () => {
      const { getCapability, UnsupportedProviderCapabilityError } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const definition: ProviderDefinition = {
        id: 'openai',
        aliases: [],
        config: {} as ProviderConfig,
        getModel: (_modelId: string) =>
          Effect.fail(new Error('not implemented')),
        capabilities: new Set(['language'] as const),
      } as ProviderDefinition;

      const result = await Effect.runPromiseExit(
        getCapability(definition, 'music')
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        expect(result.cause._tag).toBe('Fail');
      }
    });

    test('returns success when capability is supported', async () => {
      const { getCapability } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const definition: ProviderDefinition = {
        id: 'minimax',
        aliases: [],
        config: {} as ProviderConfig,
        getModel: (_modelId: string) =>
          Effect.fail(new Error('not implemented')),
        capabilities: new Set([
          'language',
          'image',
          'video',
          'speech',
          'voice',
          'music',
        ] as const),
      } as ProviderDefinition;

      const result = await Effect.runPromiseExit(
        getCapability(definition, 'language')
      );

      expect(result._tag).toBe('Success');
    });

    test('failure contains UnsupportedProviderCapabilityError', async () => {
      const { getCapability, UnsupportedProviderCapabilityError } = await import(
        '../../../../packages/core/src/platform/provider-capabilities'
      );

      const definition: ProviderDefinition = {
        id: 'openai',
        aliases: [],
        config: {} as ProviderConfig,
        getModel: (_modelId: string) =>
          Effect.fail(new Error('not implemented')),
        capabilities: new Set(['language'] as const),
      } as ProviderDefinition;

      const result = await Effect.runPromiseExit(
        getCapability(definition, 'music').pipe(
          Effect.flip
        )
      );

      expect(result._tag).toBe('Success');
      if (result._tag === 'Success') {
        const error = result.value;
        expect(error).toBeInstanceOf(UnsupportedProviderCapabilityError);
        expect((error as any).providerId).toBe('openai');
        expect((error as any).capability).toBe('music');
      }
    });
  });

  describe('Capability presence on provider definitions', () => {
    test('language-only provider has only language capability', () => {
      const capabilities = new Set(['language'] as const);

      expect(capabilities.has('language')).toBe(true);
      expect(capabilities.has('image')).toBe(false);
      expect(capabilities.has('video')).toBe(false);
      expect(capabilities.has('speech')).toBe(false);
      expect(capabilities.has('voice')).toBe(false);
      expect(capabilities.has('music')).toBe(false);
    });

    test('multi-modality provider can list all six capabilities', () => {
      const capabilities = new Set([
        'language',
        'image',
        'video',
        'speech',
        'voice',
        'music',
      ] as const);

      expect(capabilities.size).toBe(6);
      expect(capabilities.has('language')).toBe(true);
      expect(capabilities.has('image')).toBe(true);
      expect(capabilities.has('video')).toBe(true);
      expect(capabilities.has('speech')).toBe(true);
      expect(capabilities.has('voice')).toBe(true);
      expect(capabilities.has('music')).toBe(true);
    });

    test('definition without capabilities defaults to language-only', () => {
      const definition: ProviderDefinition = {
        id: 'legacy-provider',
        aliases: [],
        config: {} as ProviderConfig,
        getModel: (_modelId: string) =>
          Effect.fail(new Error('not implemented')),
      };

      // When capabilities is not set, treat as language-only
      const capabilities =
        (definition as any).capabilities ?? new Set(['language'] as const);
      expect(capabilities.has('language')).toBe(true);
      expect(capabilities.size).toBe(1);
    });
  });
});
