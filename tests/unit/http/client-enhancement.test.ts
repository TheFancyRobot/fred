import { afterEach, describe, expect, test } from 'bun:test';
import { createFred } from '../../../packages/core/src/client';
import {
  HttpClientClosedError,
  ServerAlreadyRunningError,
  ServerStartError,
  withHttp,
  type FredWithHttp,
} from '../../../packages/fred-http/src/client';

const clients: FredWithHttp[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

describe('withHttp', () => {
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
});
