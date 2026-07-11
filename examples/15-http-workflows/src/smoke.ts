import {
  generateApiKey,
  makeMemoryApiKeyStore,
} from '@fancyrobot/fred-http';
import { Effect } from 'effect';
import { createWorkflowFred } from './server';

const ORIGIN = 'http://localhost:5173';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const post = (
  baseUrl: string,
  path: string,
  input: unknown,
  token?: string,
) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: ORIGIN,
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(input),
});

async function main(): Promise<void> {
  const store = makeMemoryApiKeyStore();
  const reader = generateApiKey([], {
    id: 'smoke-reader',
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  });
  const runner = generateApiKey(['workflows:run'], {
    id: 'smoke-runner',
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  });
  const streamer = generateApiKey(['workflows:stream'], {
    id: 'smoke-streamer',
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  });
  await Effect.runPromise(Effect.all([
    store.insert(reader.record),
    store.insert(runner.record),
    store.insert(streamer.record),
  ]));

  const fred = await createWorkflowFred({
    apiKeyStore: store,
    rateLimitMaxRequests: 1,
    rateLimitWindowMs: 60_000,
  });
  const server = await fred.server.listen({ hostname: '127.0.0.1', port: 0 });

  try {
    const preflight = await fetch(`${server.url}/workflows/greet`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    assert(preflight.status === 204, `CORS preflight returned ${preflight.status}`);
    assert(preflight.headers.get('access-control-allow-origin') === ORIGIN, 'CORS origin missing');

    const noKey = await post(server.url, '/workflows/greet', { name: 'Ada' });
    assert(noKey.status === 401, `inherited auth without a key returned ${noKey.status}`);
    const greeting = await post(server.url, '/workflows/greet', { name: 'Ada' }, reader.token);
    assert(greeting.status === 200, `default workflow path returned ${greeting.status}`);
    const greetingBody = await greeting.json() as { output?: { message?: string } };
    assert(greetingBody.output?.message === 'Hello, Ada!', 'typed greeting output was incorrect');

    const wrongScope = await post(
      server.url,
      '/workflows/secure-sum',
      { values: [1, 2, 3] },
      reader.token,
    );
    assert(wrongScope.status === 403, `wrong scope returned ${wrongScope.status}`);
    const sum = await post(
      server.url,
      '/workflows/secure-sum',
      { values: [1, 2, 3] },
      runner.token,
    );
    assert(sum.status === 200, `scoped JSON workflow returned ${sum.status}`);
    const sumBody = await sum.json() as { output?: { total?: number } };
    assert(sumBody.output?.total === 6, 'scoped JSON workflow returned the wrong total');

    const stream = await post(
      server.url,
      '/workflows/progress',
      { job: 'smoke' },
      streamer.token,
    );
    assert(stream.status === 200, `SSE workflow returned ${stream.status}`);
    assert(stream.headers.get('content-type')?.includes('text/event-stream'), 'SSE content type missing');
    const events = await stream.text();
    assert(events.indexOf('"event":"started"') < events.indexOf('"event":"node-completed"'), 'SSE start order is wrong');
    assert(events.indexOf('"event":"node-completed"') < events.indexOf('"event":"completed"'), 'SSE terminal order is wrong');
    assert((events.match(/"event":"completed"/g) ?? []).length === 1, 'SSE emitted multiple terminal events');

    const publicResponse = await post(server.url, '/public/normalize', { text: '  Hello   HTTP  ' });
    assert(publicResponse.status === 200, `public custom path returned ${publicResponse.status}`);
    assert(publicResponse.headers.get('access-control-allow-origin') === ORIGIN, 'public CORS header missing');
    const publicBody = await publicResponse.json() as { output?: { normalized?: string } };
    assert(publicBody.output?.normalized === 'hello http', 'public workflow output was incorrect');
    const limited = await post(server.url, '/public/normalize', { text: 'again' });
    assert(limited.status === 429, `IP fallback rate limit returned ${limited.status}`);
    assert(limited.headers.has('retry-after'), '429 did not include Retry-After');

    const openApi = await fetch(`${server.url}/docs/openapi.json`, {
      headers: { authorization: `Bearer ${runner.token}` },
    });
    assert(openApi.status === 200, `OpenAPI returned ${openApi.status}`);
    const spec = await openApi.json() as {
      paths?: Record<string, { post?: { security?: Array<Record<string, string[]>> } }>;
      components?: { schemas?: Record<string, unknown> };
    };
    assert(spec.paths?.['/workflows/greet']?.post?.security?.length === 1, 'inherited auth metadata missing');
    assert(spec.paths?.['/public/normalize']?.post?.security?.length === 0, 'public auth opt-out metadata missing');
    assert(
      spec.paths?.['/workflows/secure-sum']?.post?.security?.[0]?.bearerAuth?.[0] === 'workflows:run',
      'scope metadata missing',
    );
    assert(JSON.stringify(spec.components?.schemas).includes('normalized'), 'derived output schema missing');

    console.log('✓ typed JSON workflows on default and custom paths');
    console.log('✓ inherited, public, and all-required scoped auth');
    console.log('✓ ordered SSE lifecycle with one terminal event');
    console.log('✓ CORS and per-IP fallback rate limiting');
    console.log('✓ generated OpenAPI security and payload schemas');
  } finally {
    await fred.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
