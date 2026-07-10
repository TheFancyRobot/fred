import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';

describe('fred-baml API stubs', () => {
  test('imports the package entrypoint without requiring generated BAML output', async () => {
    const mod = await import('../../../packages/fred-baml/src/index');

    expect(typeof mod.createBamlTool).toBe('function');
    expect(typeof mod.initFredBamlRuntime).toBe('function');
    expect(typeof mod.BamlAgent).toBe('object');
    expect(typeof mod.BamlPromptSourceLayer).toBe('function');
    expect(typeof mod.createStubBamlRuntime).toBe('function');
    expect(typeof mod.loadStubBamlClient).toBe('function');
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

  test('createBamlTool preserves runtime loader errors without wrapping them', async () => {
    const { createBamlTool, initFredBamlRuntime, MissingBamlClientError, BamlRuntimeLoadError } = await import(
      '../../../packages/fred-baml/src/index'
    );

    const missingClientTool = createBamlTool({
      id: 'missing-client',
      description: 'Fails when no loader is configured',
      inputSchema: Schema.Struct({ text: Schema.String }),
      successSchema: Schema.String,
      runtime: initFredBamlRuntime(),
      execute: async ({ text }, runtime) => {
        await runtime.loadClient();
        return text;
      },
    });

    await expect(missingClientTool.execute({ text: 'hello' })).rejects.toBeInstanceOf(MissingBamlClientError);

    const loadFailureTool = createBamlTool({
      id: 'load-failure',
      description: 'Fails when the loader throws',
      inputSchema: Schema.Struct({ text: Schema.String }),
      successSchema: Schema.String,
      runtime: initFredBamlRuntime({
        loadClient: async () => {
          throw new Error('boom');
        },
      }),
      execute: async ({ text }, runtime) => {
        await runtime.loadClient();
        return text;
      },
    });

    await expect(loadFailureTool.execute({ text: 'hello' })).rejects.toBeInstanceOf(BamlRuntimeLoadError);
  });

  test('createBamlTool wraps non-runtime execution failures in BamlToolExecutionError', async () => {
    const { createBamlTool, BamlToolExecutionError } = await import('../../../packages/fred-baml/src/index');

    const tool = createBamlTool({
      id: 'failing-tool',
      description: 'Fails after runtime resolution',
      inputSchema: Schema.Struct({ text: Schema.String }),
      successSchema: Schema.String,
      execute: async () => {
        throw new Error('no summary available');
      },
    });

    await expect(tool.execute({ text: 'hello' })).rejects.toMatchObject({
      _tag: 'BamlToolExecutionError',
      toolId: 'failing-tool',
      message: 'BAML tool `failing-tool` failed: no summary available',
    } satisfies Partial<InstanceType<typeof BamlToolExecutionError>>);
  });

  test('loadStubBamlClient resolves a deterministic stub client', async () => {
    const { loadStubBamlClient } = await import('../../../packages/fred-baml/src/index');

    await expect(loadStubBamlClient({ stub: true })).resolves.toEqual({ stub: true });
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
