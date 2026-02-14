import { describe, expect, test } from 'bun:test';
import {
  normalizePluginDeclarations,
  PluginDeclarationValidationError,
} from '../../src/plugin/schema';

describe('normalizePluginDeclarations', () => {
  test('normalizes mixed declarations and preserves order', () => {
    const normalized = normalizePluginDeclarations([
      '@acme/fred-plugin-a',
      './plugins/local-plugin.ts',
      {
        id: 'friendly-name',
        source: '@acme/fred-plugin-b',
        options: { mode: 'strict' },
      },
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized.map((entry) => entry.id)).toEqual([
      '@acme/fred-plugin-a',
      './plugins/local-plugin.ts',
      '@acme/fred-plugin-b',
    ]);
    expect(normalized.map((entry) => entry.source)).toEqual([
      '@acme/fred-plugin-a',
      './plugins/local-plugin.ts',
      '@acme/fred-plugin-b',
    ]);
    expect(normalized[1]?.sourceType).toBe('path');
    expect(normalized[2]?.declarationType).toBe('object');
    expect(normalized[2]?.declaredId).toBe('friendly-name');
    expect(normalized[2]?.options).toEqual({ mode: 'strict' });
  });

  test('throws explicit duplicate-id validation errors', () => {
    expect(() =>
      normalizePluginDeclarations([
        '@acme/fred-plugin-a',
        {
          id: 'another-id',
          source: '@acme/fred-plugin-a',
        },
      ])
    ).toThrowError(PluginDeclarationValidationError);

    expect(() =>
      normalizePluginDeclarations([
        '@acme/fred-plugin-a',
        {
          id: 'another-id',
          source: '@acme/fred-plugin-a',
        },
      ])
    ).toThrow('Duplicate plugin id "@acme/fred-plugin-a"');
  });

  test('requires explicit id in object declarations', () => {
    expect(() =>
      normalizePluginDeclarations([
        {
          source: '@acme/fred-plugin-a',
        } as any,
      ])
    ).toThrow('must include an explicit "id" field');
  });
});
