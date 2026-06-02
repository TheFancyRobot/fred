import { describe, test, expect } from 'bun:test';

// Import provider packages to trigger auto-registration
import '../../../../../packages/provider-openai/src/index';
import '../../../../../packages/provider-anthropic/src/index';
import '../../../../../packages/provider-google/src/index';
import '../../../../../packages/provider-groq/src/index';
import '../../../../../packages/provider-openrouter/src/index';
// STEP-58-01: MiniMax provider will auto-register once implemented
// import '../../../../../packages/provider-minimax/src/index';

import { Effect, Layer } from 'effect';
import {
  BUILTIN_PACKS,
  loadBuiltinPack,
  isBuiltinPack,
  getBuiltinPackIds,
} from '../../../../../packages/core/src/platform/packs/index';
import {
  hasCapability,
  getCapability,
  UnsupportedProviderCapabilityError,
  ProviderCapabilityKeys,
} from '../../../../../packages/core/src/platform/provider-capabilities';
import type { ProviderCapabilityKey } from '../../../../../packages/core/src/platform/provider-capabilities';

describe('Built-in Pack Registry', () => {
  describe('BUILTIN_PACKS', () => {
    test('includes groq provider', () => {
      expect(BUILTIN_PACKS.groq).toBeDefined();
      expect(BUILTIN_PACKS.groq.id).toBe('groq');
    });

    test('includes openrouter provider', () => {
      expect(BUILTIN_PACKS.openrouter).toBeDefined();
      expect(BUILTIN_PACKS.openrouter.id).toBe('openrouter');
    });

    test('includes all expected providers', () => {
      // ownKeys returns unique provider IDs only (aliases like 'gemini' are not enumerated)
      const expectedProviders = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      const actualProviders = Object.keys(BUILTIN_PACKS).sort();

      expect(actualProviders).toEqual(expectedProviders);
    });

    // STEP-58-01: This test will FAIL until provider-minimax is implemented
    test.todo('includes minimax provider once imported', () => {
      // Uncomment the minimax import at the top of this file to make this test pass
      // import '../../../../../packages/provider-minimax/src/index';
      expect(BUILTIN_PACKS.minimax).toBeDefined();
      expect(BUILTIN_PACKS.minimax.id).toBe('minimax');
    });

    test('all providers have required factory properties', () => {
      Object.entries(BUILTIN_PACKS).forEach(([key, factory]) => {
        expect(factory.id).toBeDefined();
        expect(typeof factory.id).toBe('string');
        expect(factory.aliases).toBeDefined();
        expect(Array.isArray(factory.aliases)).toBe(true);
        expect(typeof factory.load).toBe('function');
      });
    });
  });

  describe('loadBuiltinPack', () => {
    test('loads groq provider by id', () => {
      const pack = loadBuiltinPack('groq');
      expect(pack).not.toBeNull();
      expect(pack?.id).toBe('groq');
    });

    test('loads openrouter provider by id', () => {
      const pack = loadBuiltinPack('openrouter');
      expect(pack).not.toBeNull();
      expect(pack?.id).toBe('openrouter');
    });

    test('loads groq with case-insensitive id', () => {
      expect(loadBuiltinPack('GROQ')?.id).toBe('groq');
      expect(loadBuiltinPack('Groq')?.id).toBe('groq');
    });

    test('loads openrouter with case-insensitive id', () => {
      expect(loadBuiltinPack('OPENROUTER')?.id).toBe('openrouter');
      expect(loadBuiltinPack('OpenRouter')?.id).toBe('openrouter');
    });

    test('returns null for non-existent provider', () => {
      expect(loadBuiltinPack('nonexistent')).toBeNull();
    });

    test('loads all built-in providers', () => {
      const providers = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      providers.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();
        expect(pack?.id).toBe(id);
      });
    });
  });

  describe('isBuiltinPack', () => {
    test('returns true for groq', () => {
      expect(isBuiltinPack('groq')).toBe(true);
    });

    test('returns true for openrouter', () => {
      expect(isBuiltinPack('openrouter')).toBe(true);
    });

    test('returns true for groq with different casing', () => {
      expect(isBuiltinPack('GROQ')).toBe(true);
      expect(isBuiltinPack('Groq')).toBe(true);
    });

    test('returns true for openrouter with different casing', () => {
      expect(isBuiltinPack('OPENROUTER')).toBe(true);
      expect(isBuiltinPack('OpenRouter')).toBe(true);
    });

    test('returns false for non-existent provider', () => {
      expect(isBuiltinPack('nonexistent')).toBe(false);
    });

    test('returns true for all built-in providers', () => {
      const providers = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      providers.forEach((id) => {
        expect(isBuiltinPack(id)).toBe(true);
      });
    });
  });

  describe('getBuiltinPackIds', () => {
    test('includes groq and openrouter', () => {
      // This verifies success criteria #3: providers appear in /providers command
      // The /providers command uses getBuiltinPackIds() to list available providers
      const ids = getBuiltinPackIds();
      expect(ids).toContain('groq');
      expect(ids).toContain('openrouter');
    });

    test('returns all expected provider ids', () => {
      const ids = getBuiltinPackIds();
      const expected = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];

      expect(ids.sort()).toEqual(expected);
    });

    test('returns array of strings', () => {
      const ids = getBuiltinPackIds();
      expect(Array.isArray(ids)).toBe(true);
      ids.forEach((id) => {
        expect(typeof id).toBe('string');
      });
    });

    test('each id corresponds to a valid pack', () => {
      const ids = getBuiltinPackIds();
      ids.forEach((id) => {
        expect(BUILTIN_PACKS[id]).toBeDefined();
        expect(BUILTIN_PACKS[id].id).toBe(id);
      });
    });
  });

  // ─── STEP-58-03: Regression coverage for capability contract backward compatibility ──
  describe('existing providers remain valid language-only packs under capability contract', () => {
    const legacyProviderIds = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];

    test('all legacy providers support language capability by default', () => {
      legacyProviderIds.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();

        // Simulate the ProviderDefinition shape that createProviderDefinition produces
        // Legacy providers do not set capabilities, so the field is absent
        const definition = {
          id: pack!.id,
          aliases: pack!.aliases ?? [],
          config: {},
          getModel: () => Effect.fail(new Error('not implemented')),
          layer: Layer.empty as any,
          // Note: capabilities is intentionally NOT set
        } as any;

        expect(hasCapability(definition, 'language')).toBe(true);
      });
    });

    test('legacy providers do not support non-language capabilities', () => {
      const nonLanguageCapabilities = ProviderCapabilityKeys.filter(
        (k) => k !== 'language'
      );

      legacyProviderIds.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();

        const definition = {
          id: pack!.id,
          aliases: pack!.aliases ?? [],
          config: {},
          getModel: () => Effect.fail(new Error('not implemented')),
          layer: Layer.empty as any,
        } as any;

        nonLanguageCapabilities.forEach((cap) => {
          expect(hasCapability(definition, cap as ProviderCapabilityKey)).toBe(false);
        });
      });
    });

    test('getCapability returns UnsupportedProviderCapabilityError for non-language on legacy providers', async () => {
      const definition = {
        id: 'openai',
        aliases: [],
        config: {},
        getModel: () => Effect.fail(new Error('not implemented')),
        layer: Layer.empty as any,
      } as any;

      const result = await Effect.runPromiseExit(
        getCapability(definition, 'music')
      );

      expect(result._tag).toBe('Failure');
    });

    test('getCapability succeeds for language on legacy providers', async () => {
      const definition = {
        id: 'openai',
        aliases: [],
        config: {},
        getModel: () => Effect.fail(new Error('not implemented')),
        layer: Layer.empty as any,
      } as any;

      const result = await Effect.runPromiseExit(
        getCapability(definition, 'language')
      );

      expect(result._tag).toBe('Success');
    });

    test('legacy provider factory shape is unchanged (id, aliases, load)', () => {
      legacyProviderIds.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();

        // Verify factory still has the standard EffectProviderFactory shape
        expect(typeof pack!.id).toBe('string');
        expect(Array.isArray(pack!.aliases)).toBe(true);
        expect(typeof pack!.load).toBe('function');

        // Verify load signature accepts a config argument
        expect(pack!.load.length).toBeGreaterThanOrEqual(1);
      });
    });

    test('no mandatory non-language implementations on legacy providers', () => {
      // Legacy providers must NOT be required to implement image, video, etc.
      // This test documents the contract: factory.load() returns only
      // { layer, getModel } and nothing else is mandatory
      legacyProviderIds.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();

        // The factory object itself should only have id, aliases, load
        const ownKeys = Object.keys(pack!).sort();
        expect(ownKeys).not.toContain('capabilities');
        expect(ownKeys).not.toContain('getImageModel');
        expect(ownKeys).not.toContain('getVideoModel');
      });
    });
  });
});
