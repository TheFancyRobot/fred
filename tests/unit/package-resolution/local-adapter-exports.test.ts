import { describe, expect, test } from 'bun:test';

describe('local adapter package exports', () => {
  test('fred-baml exposes import-safe root and testing subpath exports', async () => {
    const root = await import('@fancyrobot/fred-baml');
    const testing = await import('@fancyrobot/fred-baml/testing');

    expect(typeof root.initFredBamlRuntime).toBe('function');
    expect(typeof root.createBamlTool).toBe('function');
    expect(typeof testing.createStubBamlRuntime).toBe('function');
    expect(typeof testing.loadStubBamlClient).toBe('function');
  });

  test('fred-convex exposes import-safe root and testing subpath exports', async () => {
    const root = await import('@fancyrobot/fred-convex');
    const testing = await import('@fancyrobot/fred-convex/testing');

    expect(typeof root.initFredConvexRuntime).toBe('function');
    expect(typeof root.createConvexTool).toBe('function');
    expect(typeof testing.createStubConvexRuntime).toBe('function');
    expect(typeof testing.createStubConvexClient).toBe('function');
  });
});
