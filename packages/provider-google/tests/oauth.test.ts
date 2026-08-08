import { expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import {
  createGoogleOAuthAuthorization,
  googleOAuthCredentials,
  makeGoogleOAuthRefreshCoordinator,
  refreshGoogleOAuthToken,
  refreshGoogleOAuthTokenWithStore,
  revokeGoogleOAuthToken,
  type GoogleOAuthHttpRequest,
  type GoogleOAuthRuntime,
} from '../src/oauth';

const now = new Date('2026-08-08T00:00:00.000Z');
const state = Buffer.from(new Uint8Array(32).fill(1)).toString('base64url');
const verifier = Buffer.from(new Uint8Array(64).fill(2)).toString('base64url');
const challenge = Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');

function runtime(
  request: (input: GoogleOAuthHttpRequest) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>,
  currentNow = now,
): GoogleOAuthRuntime {
  let calls = 0;
  return {
    now: () => currentNow,
    randomBytes: (length) => {
      calls += 1;
      return new Uint8Array(length).fill(calls === 1 ? 1 : 2);
    },
    sha256: async () => new Uint8Array(32).fill(3),
    request,
  };
}

test('Google OAuth creates a loopback S256 request and exchanges a state-bound callback', async () => {
  const requests: GoogleOAuthHttpRequest[] = [];
  const authorization = await Effect.runPromise(createGoogleOAuthAuthorization({
    clientId: 'google-client-id',
    redirectUri: 'http://127.0.0.1:43123/callback',
    scopes: ['scope:one', 'scope:two'],
  }, runtime(async (request) => {
    requests.push(request);
    return {
      status: 200,
      json: async () => ({
        access_token: 'google-access-token-canary',
        refresh_token: 'google-refresh-token-canary',
        expires_in: 3_600,
        scope: 'scope:one scope:two',
      }),
    };
  })));

  const url = new URL(authorization.authorizationUrl);
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('state')).toBe(state);
  expect(url.searchParams.get('code_challenge')).toBe(challenge);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');

  const token = await Effect.runPromise(authorization.complete(
    `http://127.0.0.1:43123/callback?code=google-code-canary&state=${state}`,
  ));
  expect(token.expiresAt.toISOString()).toBe('2026-08-08T00:59:00.000Z');
  expect(Redacted.value(token.accessToken)).toBe('google-access-token-canary');
  expect(googleOAuthCredentials(token)).toMatchObject({ kind: 'oauth2-bearer' });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token');
  expect(requests[0]?.body).toContain(`code_verifier=${encodeURIComponent(verifier)}`);
  expect(requests[0]?.body).toContain('code=google-code-canary');

  const replay = await Effect.runPromise(Effect.either(authorization.complete(
    `http://127.0.0.1:43123/callback?code=another-code&state=${state}`,
  )));
  expect(replay).toMatchObject({ _tag: 'Left', left: { reason: 'reused' } });
  expect(requests).toHaveLength(1);
});

test('Google OAuth rejects state tampering without sending a token request', async () => {
  let requests = 0;
  const authorization = await Effect.runPromise(createGoogleOAuthAuthorization({
    clientId: 'google-client-id',
    redirectUri: 'http://127.0.0.1:43123/callback',
    scopes: ['scope:one'],
  }, runtime(async () => {
    requests += 1;
    return { status: 200, json: async () => ({}) };
  })));

  const result = await Effect.runPromise(Effect.either(authorization.complete(
    'http://127.0.0.1:43123/callback?code=code-canary&state=wrong-state',
  )));
  expect(result).toMatchObject({ _tag: 'Left', left: { reason: 'state-mismatch' } });
  expect(requests).toBe(0);
});

test('Google OAuth refresh retains a non-rotated refresh token and redacts rejection details', async () => {
  const current = {
    accessToken: Redacted.make('old-access-token-canary'),
    refreshToken: Redacted.make('old-refresh-token-canary'),
    expiresAt: now,
    scopes: ['scope:one'],
  };
  const refreshed = await Effect.runPromise(refreshGoogleOAuthToken(current, {
    clientId: 'google-client-id',
  }, runtime(async () => ({
    status: 200,
    json: async () => ({ access_token: 'new-access-token-canary', expires_in: 120 }),
  }))));
  expect(Redacted.value(refreshed.accessToken)).toBe('new-access-token-canary');
  expect(Redacted.value(refreshed.refreshToken)).toBe('old-refresh-token-canary');
  expect(refreshed.expiresAt.toISOString()).toBe('2026-08-08T00:01:00.000Z');

  const failure = await Effect.runPromise(Effect.either(revokeGoogleOAuthToken(
    Redacted.make('revoke-token-canary'),
    runtime(async () => ({ status: 400, json: async () => ({ error: 'revoke-token-canary' }) })),
  )));
  expect(failure).toMatchObject({ _tag: 'Left', left: { operation: 'revoke' } });
  expect(JSON.stringify(failure)).not.toContain('revoke-token-canary');
});

test('Google OAuth refresh coordinates in-process callers and reloads an encrypted-store CAS winner', async () => {
  const stale = {
    accessToken: Redacted.make('stale-access-token'),
    refreshToken: Redacted.make('stale-refresh-token'),
    expiresAt: now,
    scopes: ['scope:one'],
  };
  let requests = 0;
  let writes = 0;
  let stored = { token: stale, version: 1 };
  const coordinator = await Effect.runPromise(makeGoogleOAuthRefreshCoordinator({
    load: () => Effect.succeed(stored),
    compareAndSet: (_version, token) => Effect.sync(() => {
      writes += 1;
      stored = { token, version: 2 };
      return true;
    }),
  }, { clientId: 'google-client-id' }, runtime(async () => {
    requests += 1;
    return {
      status: 200,
      json: async () => ({
        access_token: 'coordinated-access-token',
        refresh_token: 'coordinated-refresh-token',
        expires_in: 3_600,
      }),
    };
  })));
  const refreshed = await Effect.runPromise(Effect.all([
    coordinator.refresh(),
    coordinator.refresh(),
    coordinator.refresh(),
  ], { concurrency: 'unbounded' }));
  expect(requests).toBe(1);
  expect(writes).toBe(1);
  expect(refreshed.map((token) => Redacted.value(token.accessToken))).toEqual([
    'coordinated-access-token',
    'coordinated-access-token',
    'coordinated-access-token',
  ]);

  const winning = {
    token: {
      accessToken: Redacted.make('winner-access-token'),
      refreshToken: Redacted.make('winner-refresh-token'),
      expiresAt: new Date('2026-08-08T01:00:00.000Z'),
      scopes: ['scope:one'],
    },
    version: 2,
  };
  let loads = 0;
  const winner = await Effect.runPromise(refreshGoogleOAuthTokenWithStore({
    load: () => Effect.sync(() => {
      loads += 1;
      return loads === 1 ? { token: stale, version: 1 } : winning;
    }),
    compareAndSet: () => Effect.succeed(false),
  }, { clientId: 'google-client-id' }, runtime(async () => ({
    status: 200,
    json: async () => ({
      access_token: 'losing-access-token',
      refresh_token: 'losing-refresh-token',
      expires_in: 3_600,
    }),
  }))));
  expect(Redacted.value(winner.accessToken)).toBe('winner-access-token');
  expect(loads).toBe(2);
});
