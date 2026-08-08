import { expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import {
  createOpenRouterOAuthAuthorization,
  openRouterOAuthCredentials,
  type OpenRouterOAuthHttpRequest,
  type OpenRouterOAuthRuntime,
} from '../src/oauth';

const now = new Date('2026-08-08T00:00:00.000Z');
const state = Buffer.from(new Uint8Array(32).fill(1)).toString('base64url');
const verifier = Buffer.from(new Uint8Array(64).fill(2)).toString('base64url');
const challenge = Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');

function runtime(
  request: (input: OpenRouterOAuthHttpRequest) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>,
  currentNow: () => Date = () => now,
): OpenRouterOAuthRuntime {
  let calls = 0;
  return {
    now: currentNow,
    randomBytes: (length) => {
      calls += 1;
      return new Uint8Array(length).fill(calls === 2 ? 1 : 2);
    },
    sha256: async () => new Uint8Array(32).fill(3),
    request,
  };
}

test('OpenRouter exchanges a state-bound loopback callback for an API key', async () => {
  const requests: OpenRouterOAuthHttpRequest[] = [];
  const authorization = await Effect.runPromise(createOpenRouterOAuthAuthorization({
    callbackUrl: 'http://localhost:43123/callback',
    keyLabel: 'Fred test',
  }, runtime(async (request) => {
    requests.push(request);
    return { status: 200, json: async () => ({ key: 'openrouter-key-canary' }) };
  })));

  expect(authorization.mode).toBe('callback');
  if (authorization.mode !== 'callback') throw new Error('expected callback mode');
  const url = new URL(authorization.authorizationUrl);
  expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
  expect(url.searchParams.get('code_challenge')).toBe(challenge);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('key_label')).toBe('Fred test');
  const callback = new URL(url.searchParams.get('callback_url')!);
  expect(callback.searchParams.get('state')).toBe(state);

  const key = await Effect.runPromise(authorization.completeCallback(
    `http://localhost:43123/callback?state=${state}&code=openrouter-code-canary`,
  ));
  expect(Redacted.value(key.apiKey)).toBe('openrouter-key-canary');
  expect(openRouterOAuthCredentials(key)).toMatchObject({ kind: 'api-key' });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    url: 'https://openrouter.ai/api/v1/auth/keys',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(requests[0]!.body)).toEqual({
    code: 'openrouter-code-canary',
    code_verifier: verifier,
    code_challenge_method: 'S256',
  });

  const replay = await Effect.runPromise(Effect.either(authorization.completeCallback(
    `http://localhost:43123/callback?state=${state}&code=another-code`,
  )));
  expect(replay).toMatchObject({ _tag: 'Left', left: { reason: 'reused' } });
});

test('OpenRouter rejects callback state tampering before exchange', async () => {
  let requests = 0;
  const authorization = await Effect.runPromise(createOpenRouterOAuthAuthorization({
    callbackUrl: 'http://localhost:43123/callback',
  }, runtime(async () => {
    requests += 1;
    return { status: 200, json: async () => ({}) };
  })));
  if (authorization.mode !== 'callback') throw new Error('expected callback mode');

  const failure = await Effect.runPromise(Effect.either(authorization.completeCallback(
    'http://localhost:43123/callback?state=wrong-state&code=openrouter-code-canary',
  )));
  expect(failure).toMatchObject({ _tag: 'Left', left: { reason: 'state-mismatch' } });
  expect(requests).toBe(0);
});

test('OpenRouter headless codes expire after ten minutes and exchange failures stay sanitized', async () => {
  const authorization = await Effect.runPromise(createOpenRouterOAuthAuthorization({
    keyLabel: 'Fred headless',
  }, runtime(async () => ({ status: 403, json: async () => ({ error: 'headless-code-canary' }) }))));
  expect(authorization.mode).toBe('headless');
  if (authorization.mode !== 'headless') throw new Error('expected headless mode');
  const url = new URL(authorization.authorizationUrl);
  expect(url.searchParams.has('callback_url')).toBe(false);
  expect(url.searchParams.get('key_label')).toBe('Fred headless');

  const failure = await Effect.runPromise(Effect.either(authorization.completeCode('headless-code-canary')));
  expect(failure).toMatchObject({ _tag: 'Left', left: { _tag: 'OpenRouterOAuthExchangeError' } });
  expect(JSON.stringify(failure)).not.toContain('headless-code-canary');

  let currentNow = now;
  const expiredRuntime = runtime(
    async () => ({ status: 200, json: async () => ({ key: 'unused' }) }),
    () => currentNow,
  );
  const expired = await Effect.runPromise(createOpenRouterOAuthAuthorization({}, expiredRuntime));
  if (expired.mode !== 'headless') throw new Error('expected headless mode');
  currentNow = new Date('2026-08-08T00:10:00.000Z');
  const timeout = await Effect.runPromise(Effect.either(expired.completeCode('expired-code')));
  expect(timeout).toMatchObject({ _tag: 'Left', left: { reason: 'expired' } });
});
