import { afterEach, describe, expect, test } from 'bun:test';
import { createFred } from '../../../packages/core/src/client';
import { defineWorkflow } from '../../../packages/core/src/workflow/compile';
import { Schema } from 'effect';
import {
  HttpClientClosedError,
  ServerAlreadyRunningError,
  ServerStartError,
  withHttp,
  type FredWithHttp,
} from '../../../packages/fred-http/src/client';
import { WorkflowEndpointConfigurationError } from '../../../packages/fred-http/src/workflows';

const clients: FredWithHttp[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

describe('withHttp', () => {
  test('generates and exposes a usable auth token for the secure default', async () => {
    const fred = withHttp(await createFred());
    clients.push(fred);
    const handle = await fred.server.listen();

    expect(handle.authToken).toBeTruthy();
    expect((await fetch(`${handle.url}/health`)).status).toBe(401);
    expect((await fetch(`${handle.url}/health`, {
      headers: { authorization: `Bearer ${handle.authToken}` },
    })).status).toBe(200);
  });

  test('returns a non-mutating enhanced view backed by the same Fred runtime', async () => {
    const core = await createFred();
    const fred = withHttp(core, { security: { requireAuth: false } });
    clients.push(fred);

    expect('server' in core).toBe(false);
    expect(fred.runtime).toBe(core.runtime);

    const handle = await fred.server.listen();
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });

  test('rejects double listen and allows an idempotent stop followed by restart', async () => {
    const fred = withHttp(await createFred(), { security: { requireAuth: false } });
    clients.push(fred);

    const first = await fred.server.listen();
    await expect(fred.server.listen()).rejects.toBeInstanceOf(ServerAlreadyRunningError);
    await fred.server.stop();
    await fred.server.stop();

    const second = await fred.server.listen();
    expect(second.port).toBeGreaterThan(0);
    expect((await fetch(`${second.url}/health`)).status).toBe(200);
    expect(first).not.toBe(second);
  });

  test('shutdown is idempotent and rejects later listen attempts', async () => {
    const fred = withHttp(await createFred(), { security: { requireAuth: false } });
    await fred.server.listen();
    await Promise.all([fred.shutdown(), fred.shutdown()]);

    await expect(fred.server.listen()).rejects.toBeInstanceOf(HttpClientClosedError);
  });

  test('closes a partial Scope after bind failure and remains restartable', async () => {
    const occupied = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('occupied'),
    });
    const fred = withHttp(await createFred(), { security: { requireAuth: false } });
    clients.push(fred);
    const occupiedPort = occupied.port;

    await expect(fred.server.listen({ port: occupiedPort })).rejects.toBeInstanceOf(ServerStartError);
    occupied.stop(true);

    const handle = await fred.server.listen({ port: occupiedPort });
    expect(handle.port).toBe(occupiedPort);
  });

  test('snapshots typed JSON workflow endpoints when the listener starts', async () => {
    const core = await createFred();
    await core.workflows.define(defineWorkflow({
      id: 'greet',
      entry: 'greet',
      nodes: [{
        id: 'greet',
        kind: 'function',
        fn: (context) => ({ greeting: `Hello, ${(context.input as { name: string }).name}` }),
      }],
      edges: [],
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Struct({ greeting: Schema.String }),
    }));
    const fred = withHttp(core, {
      security: { requireAuth: false },
      workflowEndpoints: true,
    });
    clients.push(fred);
    const handle = await fred.server.listen();

    const response = await fetch(`${handle.url}/workflows/greet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      status: 'completed',
      workflowId: 'greet',
      output: { greeting: 'Hello, Ada' },
    });

    const invalid = await fetch(`${handle.url}/workflows/greet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 42, secret: 'must-not-leak' }),
    });
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.text();
    expect(invalidBody).toContain('Invalid request');
    expect(invalidBody).not.toContain('must-not-leak');

    await core.workflows.define(defineWorkflow({
      id: 'late',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'late' }],
      edges: [],
    }));
    expect((await fetch(`${handle.url}/workflows/late`, { method: 'POST' })).status).toBe(404);

    const spec = await (await fetch(`${handle.url}/docs/openapi.json`)).json() as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.paths['/workflows/greet']).toBeDefined();
    expect(JSON.stringify(spec.components.schemas)).toContain('greeting');
  });

  test('streams ordered workflow lifecycle events with one terminal event', async () => {
    const core = await createFred();
    await core.workflows.define(defineWorkflow({
      id: 'streamed',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'ok' }],
      edges: [],
    }));
    const fred = withHttp(core, {
      security: { requireAuth: false },
      workflowEndpoints: { streamed: { stream: true, auth: false } },
    });
    clients.push(fred);
    const handle = await fred.server.listen();

    const response = await fetch(`${handle.url}/workflows/streamed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('input'),
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body.indexOf('"event":"started"')).toBeLessThan(body.indexOf('"event":"node-completed"'));
    expect(body.indexOf('"event":"node-completed"')).toBeLessThan(body.indexOf('"event":"completed"'));
    expect(body.match(/"event":"completed"/g)).toHaveLength(1);
    expect(body).not.toContain('kind');

    const spec = await (await fetch(`${handle.url}/docs/openapi.json`)).json() as {
      paths: Record<string, { post?: { security?: unknown[]; responses?: Record<string, unknown> } }>;
    };
    expect(spec.paths['/workflows/streamed']?.post?.security).toEqual([]);
    expect(JSON.stringify(spec.paths['/workflows/streamed']?.post?.responses)).toContain('text/event-stream');
  });

  test('releases an SSE request when the consumer disconnects mid-workflow', async () => {
    const core = await createFred();
    await core.workflows.define(defineWorkflow({
      id: 'cancelled-stream',
      entry: 'slow',
      nodes: [{
        id: 'slow',
        kind: 'function',
        fn: async () => {
          await Bun.sleep(50);
          return 'done';
        },
      }],
      edges: [],
    }));
    const fred = withHttp(core, {
      security: { requireAuth: false },
      workflowEndpoints: { 'cancelled-stream': { stream: true } },
    });
    clients.push(fred);
    const handle = await fred.server.listen();
    const response = await fetch(`${handle.url}/workflows/cancelled-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('input'),
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"event":"started"');
    await reader.cancel();
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });

  test('rejects unknown, reserved, and duplicate workflow endpoint configuration before binding', async () => {
    const core = await createFred();
    await core.workflows.define(defineWorkflow({
      id: 'first',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'ok' }],
      edges: [],
    }));
    await core.workflows.define(defineWorkflow({
      id: 'second',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'ok' }],
      edges: [],
    }));

    const unknown = withHttp(core, { workflowEndpoints: { missing: {} } });
    await expect(unknown.server.listen()).rejects.toBeInstanceOf(WorkflowEndpointConfigurationError);

    const reserved = withHttp(core, { workflowEndpoints: { first: { path: '/health' } } });
    await expect(reserved.server.listen()).rejects.toBeInstanceOf(WorkflowEndpointConfigurationError);

    const duplicated = withHttp(core, {
      workflowEndpoints: { first: { path: '/run' }, second: { path: '/run' } },
    });
    await expect(duplicated.server.listen()).rejects.toBeInstanceOf(WorkflowEndpointConfigurationError);
    await core.shutdown();
  });
});
