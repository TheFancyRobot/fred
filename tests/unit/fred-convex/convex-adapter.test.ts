import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  MissingConvexClientError,
  ConvexRuntimeLoadError,
  ConvexFunctionCallError,
  ConvexToolExecutionError,
} from '../../../packages/fred-convex/src/errors';
import {
  initFredConvexRuntime,
  type ConvexClient,
  type FredConvexRuntime,
} from '../../../packages/fred-convex/src/runtime';
import {
  callConvexQuery,
  callConvexMutation,
  callConvexAction,
  createConvexTool,
} from '../../../packages/fred-convex/src/tools';
import { createStubConvexRuntime, createStubConvexClient } from '../../../packages/fred-convex/src/testing';
import { Fred } from '../../../packages/core/src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRuntimeWithClient(client: ConvexClient): FredConvexRuntime {
  return initFredConvexRuntime({
    config: { url: 'https://test.convex.cloud' },
    loadClient: () => client,
  });
}

function makeRuntimeWithoutClient(): FredConvexRuntime {
  return initFredConvexRuntime({
    config: { url: 'https://test.convex.cloud' },
  });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

describe('initFredConvexRuntime', () => {
  test('returns a runtime with the given config', () => {
    const runtime = initFredConvexRuntime({
      config: { url: 'https://my-deploy.convex.cloud', authToken: 'tok123' },
    });
    expect(runtime.config.url).toBe('https://my-deploy.convex.cloud');
    expect(runtime.config.authToken).toBe('tok123');
  });

  test('throws MissingConvexClientError when loadClient is not provided', async () => {
    const runtime = makeRuntimeWithoutClient();
    try {
      await runtime.loadClient();
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConvexClientError);
    }
  });

  test('throws ConvexRuntimeLoadError when loadClient rejects', async () => {
    const runtime = initFredConvexRuntime({
      config: { url: 'https://test.convex.cloud' },
      loadClient: async () => { throw new Error('network failure'); },
    });
    try {
      await runtime.loadClient();
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexRuntimeLoadError);
    }
  });

  test('returns client when loadClient succeeds', async () => {
    const stub = createStubConvexClient();
    const runtime = makeRuntimeWithClient(stub);
    const client = await runtime.loadClient();
    expect(client).toBe(stub);
  });
});

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

describe('createStubConvexRuntime', () => {
  test('returns runtime and client with configured responses', async () => {
    const { runtime, client } = createStubConvexRuntime({
      query: { 'api/tasks:list': [{ _id: '1', title: 'Test' }] },
    });
    const loadedClient = await runtime.loadClient();
    expect(loadedClient).toBe(client);

    const result = await client.query('api/tasks:list');
    expect(result).toEqual([{ _id: '1', title: 'Test' }]);
  });

  test('stub client throws for unconfigured function references', async () => {
    const { client } = createStubConvexRuntime();
    expect(client.query('api/unknown:fn')).rejects.toThrow(/no response configured/);
  });
});

// ---------------------------------------------------------------------------
// Call helpers
// ---------------------------------------------------------------------------

describe('callConvexQuery', () => {
  test('dispatches to client.query', async () => {
    const stub = createStubConvexClient({ query: { 'api/tasks:list': [{ _id: '1' }] } });
    const runtime = makeRuntimeWithClient(stub);
    const result = await callConvexQuery(runtime, 'api/tasks:list');
    expect(result).toEqual([{ _id: '1' }]);
  });

  test('passes args to client.query', async () => {
    const stub = createStubConvexClient({ query: { 'api/tasks:get': { _id: '42' } } });
    const runtime = makeRuntimeWithClient(stub);
    const result = await callConvexQuery(runtime, 'api/tasks:get', { id: '42' });
    expect(result).toEqual({ _id: '42' });
  });

  test('accepts object-style function references', async () => {
    const listTasksRef = { module: 'tasks', name: 'list' };
    const { runtime } = createStubConvexRuntime({
      query: { [JSON.stringify(listTasksRef)]: [{ _id: 'obj-1' }] },
    });

    await expect(callConvexQuery(runtime, listTasksRef)).resolves.toEqual([{ _id: 'obj-1' }]);
  });

  test('preserves class-based client method bindings', async () => {
    class BoundClient implements ConvexClient {
      private readonly responses = new Map([['api/tasks:list', [{ _id: '1' }]]]);

      async query(functionReference: string): Promise<unknown> {
        return this.responses.get(functionReference);
      }

      async mutation(functionReference: string): Promise<unknown> {
        return this.responses.get(functionReference);
      }

      async action(functionReference: string): Promise<unknown> {
        return this.responses.get(functionReference);
      }
    }

    const runtime = makeRuntimeWithClient(new BoundClient());
    await expect(callConvexQuery(runtime, 'api/tasks:list')).resolves.toEqual([{ _id: '1' }]);
  });

  test('rejects wrong function type against typed stubs', async () => {
    const stub = createStubConvexClient({ query: { 'api/tasks:list': [{ _id: '1' }] } });
    await expect(stub.mutation('api/tasks:list')).rejects.toThrow(/no response configured for mutation/);
  });

  test('wraps client errors as ConvexFunctionCallError', async () => {
    const stub = createStubConvexClient();
    const runtime = makeRuntimeWithClient(stub);
    try {
      await callConvexQuery(runtime, 'api/unknown:fn');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexFunctionCallError);
      const e = err as ConvexFunctionCallError;
      expect(e.functionName).toBe('api/unknown:fn');
      expect(e.functionType).toBe('query');
    }
  });
});

describe('callConvexMutation', () => {
  test('dispatches to client.mutation', async () => {
    const stub = createStubConvexClient({ mutation: { 'api/tasks:create': { _id: 'new' } } });
    const runtime = makeRuntimeWithClient(stub);
    const result = await callConvexMutation(runtime, 'api/tasks:create', { title: 'New' });
    expect(result).toEqual({ _id: 'new' });
  });

  test('wraps client errors as ConvexFunctionCallError with mutation type', async () => {
    const stub = createStubConvexClient();
    const runtime = makeRuntimeWithClient(stub);
    try {
      await callConvexMutation(runtime, 'api/unknown:fn');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexFunctionCallError);
      expect((err as ConvexFunctionCallError).functionType).toBe('mutation');
    }
  });
});

describe('callConvexAction', () => {
  test('dispatches to client.action', async () => {
    const stub = createStubConvexClient({ action: { 'api/tasks:process': 'done' } });
    const runtime = makeRuntimeWithClient(stub);
    const result = await callConvexAction(runtime, 'api/tasks:process');
    expect(result).toBe('done');
  });

  test('wraps client errors as ConvexFunctionCallError with action type', async () => {
    const stub = createStubConvexClient();
    const runtime = makeRuntimeWithClient(stub);
    try {
      await callConvexAction(runtime, 'api/unknown:fn');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexFunctionCallError);
      expect((err as ConvexFunctionCallError).functionType).toBe('action');
    }
  });
});

describe('call helpers passthrough', () => {
  test('MissingConvexClientError passes through without wrapping', async () => {
    const runtime = makeRuntimeWithoutClient();
    try {
      await callConvexQuery(runtime, 'api/any:fn');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConvexClientError);
    }
  });

  test('ConvexRuntimeLoadError passes through without wrapping', async () => {
    const runtime = initFredConvexRuntime({
      config: { url: 'https://test.convex.cloud' },
      loadClient: async () => { throw new Error('load fail'); },
    });
    try {
      await callConvexQuery(runtime, 'api/any:fn');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexRuntimeLoadError);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool adapter
// ---------------------------------------------------------------------------

describe('createConvexTool', () => {
  test('returns a Fred Tool with correct metadata', () => {
    const { runtime } = createStubConvexRuntime({ mutation: { 'api/tasks:create': { _id: '1' } } });
    const tool = createConvexTool({
      id: 'convex.createTask',
      description: 'Create a task',
      functionReference: 'api/tasks:create',
      functionType: 'mutation',
      inputSchema: Schema.Struct({ title: Schema.String }),
      successSchema: Schema.Struct({ _id: Schema.String }),
      runtime,
    });

    expect(tool.id).toBe('convex.createTask');
    expect(tool.name).toBe('convex.createTask');
    expect(tool.description).toBe('Create a task');
    expect(tool.schema?.input).toBeDefined();
    expect(tool.schema?.success).toBeDefined();
    expect(tool.strict).toBe(true);
  });

  test('executes a query-backed tool', async () => {
    const { runtime } = createStubConvexRuntime({ query: { 'api/tasks:list': [{ _id: '1', title: 'Hello' }] } });
    const tool = createConvexTool({
      id: 'convex.listTasks',
      description: 'List tasks',
      functionReference: 'api/tasks:list',
      functionType: 'query',
      inputSchema: Schema.Struct({}),
      successSchema: Schema.Array(Schema.Struct({ _id: Schema.String, title: Schema.String })),
      runtime,
    });

    const result = await tool.execute({});
    expect(result).toEqual([{ _id: '1', title: 'Hello' }]);
  });

  test('executes a mutation-backed tool with mapInput', async () => {
    const { runtime } = createStubConvexRuntime({ mutation: { 'api/tasks:create': { _id: '99' } } });
    const tool = createConvexTool({
      id: 'convex.createTask',
      description: 'Create a task',
      functionReference: 'api/tasks:create',
      functionType: 'mutation',
      inputSchema: Schema.Struct({ taskTitle: Schema.String }),
      successSchema: Schema.Struct({ _id: Schema.String }),
      runtime,
      mapInput: (input) => ({ title: input.taskTitle }),
    });

    const result = await tool.execute({ taskTitle: 'Build feature' });
    expect(result).toEqual({ _id: '99' });
  });

  test('wraps execution errors as ConvexToolExecutionError', async () => {
    const { runtime } = createStubConvexRuntime(); // no response configured
    const tool = createConvexTool({
      id: 'convex.failTool',
      description: 'Will fail',
      functionReference: 'api/unknown:fn',
      functionType: 'query',
      inputSchema: Schema.Struct({}),
      successSchema: Schema.Unknown,
      runtime,
    });

    try {
      await tool.execute({});
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexToolExecutionError);
      expect((err as ConvexToolExecutionError).toolId).toBe('convex.failTool');
    }
  });

  test('MissingConvexClientError passes through tool execution', async () => {
    const runtime = makeRuntimeWithoutClient();
    const tool = createConvexTool({
      id: 'convex.noClient',
      description: 'No client',
      functionReference: 'api/any:fn',
      functionType: 'query',
      inputSchema: Schema.Struct({}),
      successSchema: Schema.Unknown,
      runtime,
    });

    try {
      await tool.execute({});
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConvexClientError);
    }
  });
});

// ---------------------------------------------------------------------------
// Fred integration
// ---------------------------------------------------------------------------

describe('Fred integration', () => {
  test('registers and executes a Convex-backed tool through Fred', async () => {
    const { runtime } = createStubConvexRuntime({ query: { 'api/tasks:list': [{ _id: '1', title: 'Test' }] } });

    const tool = createConvexTool({
      id: 'convex.listTasks',
      description: 'List all tasks',
      functionReference: 'api/tasks:list',
      functionType: 'query',
      inputSchema: Schema.Struct({}),
      successSchema: Schema.Array(Schema.Struct({ _id: Schema.String, title: Schema.String })),
      runtime,
    });

    const fred = await Fred.create();
    fred.registerTool(tool);

    const registeredTool = fred.getTool('convex.listTasks');
    expect(registeredTool).toBeDefined();
    await expect(registeredTool?.execute({})).resolves.toEqual([{ _id: '1', title: 'Test' }]);
  });
});
