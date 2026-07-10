import { createHttpFred } from './server';

const AUTH_TOKEN = 'credential-free-smoke-token';
const ORIGIN = 'http://localhost:5173';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const authHeaders = (): Headers => {
  const headers = new Headers();
  // This is the client half of bearer auth. In a real application, read the
  // token from a secret store/environment variable rather than source code.
  headers.set('Authorization', `Bearer ${AUTH_TOKEN}`);
  headers.set('Origin', ORIGIN);
  return headers;
};

async function main(): Promise<void> {
  const fred = await createHttpFred({
    authToken: AUTH_TOKEN,
    enableModel: false,
    // Eight non-OPTIONS requests are made before the explicit 429 check.
    rateLimitMaxRequests: 8,
    rateLimitWindowMs: 60_000,
  });
  const server = await fred.server.listen({ hostname: '127.0.0.1', port: 0 });

  try {
    const preflight = await fetch(`${server.url}/message`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Session-Id',
      },
    });
    assert(preflight.status === 204, `CORS preflight returned ${preflight.status}`);
    assert(
      preflight.headers.get('access-control-allow-origin') === ORIGIN,
      'CORS preflight did not echo the allowed origin',
    );

    const unauthorized = await fetch(`${server.url}/health`, {
      headers: { Origin: ORIGIN },
    });
    assert(unauthorized.status === 401, `missing bearer token returned ${unauthorized.status}`);
    assert(
      unauthorized.headers.get('access-control-allow-origin') === ORIGIN,
      '401 response did not retain CORS headers',
    );

    const paths = ['/health', '/status', '/agents', '/intents', '/tools'] as const;
    for (const path of paths) {
      const response = await fetch(`${server.url}${path}`, { headers: authHeaders() });
      assert(response.status === 200, `${path} returned ${response.status}`);
      assert(
        response.headers.get('access-control-allow-origin') === ORIGIN,
        `${path} did not include the expected CORS header`,
      );
      const body = await response.json();
      assert(body !== null && typeof body === 'object', `${path} did not return JSON`);
    }

    const openApi = await fetch(`${server.url}/docs/openapi.json`, { headers: authHeaders() });
    assert(openApi.status === 200, `OpenAPI document returned ${openApi.status}`);
    const specification = await openApi.json() as { paths?: Record<string, unknown> };
    assert(specification.paths?.['/v1/chat/completions'], 'OpenAPI is missing chat completions');
    assert(specification.paths?.['/message'], 'OpenAPI is missing the native message endpoint');

    const docs = await fetch(`${server.url}/docs`, { headers: authHeaders() });
    assert(docs.status === 200, `interactive docs returned ${docs.status}`);
    assert((await docs.text()).toLowerCase().includes('<html'), 'interactive docs did not return HTML');

    const limited = await fetch(`${server.url}/health`, { headers: authHeaders() });
    assert(limited.status === 429, `rate limit check returned ${limited.status}`);
    assert(limited.headers.has('retry-after'), '429 response did not include Retry-After');

    console.log('✓ server started on an ephemeral port');
    console.log('✓ CORS preflight and response headers');
    console.log('✓ bearer authentication rejection and success');
    console.log('✓ health, status, agents, intents, and tools');
    console.log('✓ OpenAPI JSON and interactive docs');
    console.log('✓ rate limiting and Retry-After');
  } finally {
    await fred.shutdown();
  }

  console.log('✓ coordinated HTTP and Fred shutdown');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
