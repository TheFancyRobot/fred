import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';

describe('fred-baml API stubs', () => {
  test('imports the package entrypoint without requiring generated BAML output', async () => {
    const mod = await import('../../../packages/fred-baml/src/index');

    expect(typeof mod.createBamlTool).toBe('function');
    expect(typeof mod.initFredBamlRuntime).toBe('function');
    expect(typeof mod.BamlAgent).toBe('object');
    expect(typeof mod.createStubBamlRuntime).toBe('function');
    expect(typeof mod.MissingBamlClientError).toBe('function');
  });

  test('runtime helper defers client loading until explicitly requested', async () => {
    const { initFredBamlRuntime, MissingBamlClientError } = await import('../../../packages/fred-baml/src/index');

    const runtime = initFredBamlRuntime();

    await expect(runtime.loadClient()).rejects.toBeInstanceOf(MissingBamlClientError);
  });

  test('createBamlTool returns a Fred-compatible tool stub', async () => {
    const { createBamlTool } = await import('../../../packages/fred-baml/src/index');

    const tool = createBamlTool({
      id: 'summarize',
      description: 'Summarize text via BAML',
      inputSchema: Schema.Struct({ text: Schema.String }),
      successSchema: Schema.String,
      execute: async ({ text }) => `summary:${text}`,
    });

    expect(tool.id).toBe('summarize');
    expect(tool.name).toBe('summarize');
    await expect(tool.execute({ text: 'hello' })).resolves.toBe('summary:hello');
  });

  test('BamlAgent helper builds an agent config with explicit tool ids', async () => {
    const { BamlAgent } = await import('../../../packages/fred-baml/src/index');

    const config = BamlAgent.createConfig({
      id: 'planner',
      platform: 'openai',
      model: 'gpt-4o-mini',
      tools: ['baml.summarize'],
      systemMessage: 'Plan work',
    });

    expect(config.id).toBe('planner');
    expect(config.tools).toEqual(['baml.summarize']);
    expect(config.systemMessage).toBe('Plan work');
  });
});
