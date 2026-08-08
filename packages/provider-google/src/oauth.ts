import { Buffer } from 'node:buffer';
import { Data, Deferred, Effect, Option, Redacted, Ref } from 'effect';
import type { ProviderConnectionCredentials } from '@fancyrobot/fred';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1_000;
const TOKEN_EXPIRY_SKEW_MS = 60 * 1_000;

export type GoogleOAuthCallbackReason =
  | 'denied'
  | 'expired'
  | 'invalid-callback'
  | 'missing-code'
  | 'reused'
  | 'state-mismatch';

export type GoogleOAuthTokenOperation = 'exchange' | 'refresh' | 'revoke';

export class GoogleOAuthConfigurationError extends Data.TaggedError(
  'GoogleOAuthConfigurationError',
)<{ readonly message: string }> {}

/** A callback was not the pending authorization response. No authorization code is retained in this error. */
export class GoogleOAuthCallbackError extends Data.TaggedError(
  'GoogleOAuthCallbackError',
)<{ readonly reason: GoogleOAuthCallbackReason; readonly message: string }> {}

/** Token endpoint failures intentionally exclude provider response bodies and credentials. */
export class GoogleOAuthTokenError extends Data.TaggedError(
  'GoogleOAuthTokenError',
)<{ readonly operation: GoogleOAuthTokenOperation; readonly message: string }> {}

export interface GoogleOAuthHttpRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GoogleOAuthHttpResponse {
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

/** Injectable seams keep protocol tests deterministic and keep browser/listener ownership with the host application. */
export interface GoogleOAuthRuntime {
  readonly now: () => Date;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly sha256: (input: Uint8Array) => Promise<Uint8Array>;
  readonly request: (request: GoogleOAuthHttpRequest) => Promise<GoogleOAuthHttpResponse>;
}

export interface GoogleOAuthClientRegistration {
  readonly clientId: string;
  /** Optional because installed-app clients cannot keep this value confidential. Fred never supplies one. */
  readonly clientSecret?: Redacted.Redacted<string>;
}

export interface GoogleOAuthAuthorizationOptions extends GoogleOAuthClientRegistration {
  /** Must be a host-owned random-port loopback listener, not an OOB or embedded-webview flow. */
  readonly redirectUri: string;
  /** Fred passes these verbatim after rejecting blank and duplicate values. */
  readonly scopes: readonly string[];
  readonly timeoutMs?: number;
}

export interface GoogleOAuthToken {
  readonly accessToken: Redacted.Redacted<string>;
  readonly refreshToken: Redacted.Redacted<string>;
  readonly expiresAt: Date;
  readonly scopes: readonly string[];
}

export interface GoogleOAuthAuthorization {
  readonly authorizationUrl: string;
  readonly expiresAt: Date;
  readonly complete: (
    callbackUrl: string,
  ) => Effect.Effect<GoogleOAuthToken, GoogleOAuthCallbackError | GoogleOAuthTokenError>;
}

/** A host adapter backed by encrypted storage. `compareAndSet` must persist the token and expiry atomically. */
export interface GoogleOAuthRefreshStore<E> {
  readonly load: () => Effect.Effect<{
    readonly token: GoogleOAuthToken;
    readonly version: number;
  }, E>;
  readonly compareAndSet: (
    expectedVersion: number,
    token: GoogleOAuthToken,
  ) => Effect.Effect<boolean, E>;
}

export type GoogleOAuthRefreshError<E> =
  | E
  | GoogleOAuthConfigurationError
  | GoogleOAuthTokenError;

export interface GoogleOAuthRefreshCoordinator<E> {
  readonly refresh: () => Effect.Effect<GoogleOAuthToken, GoogleOAuthRefreshError<E>>;
}

const arrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const base64Url = (value: Uint8Array): string => Buffer.from(value).toString('base64url');

const defaultRuntime: GoogleOAuthRuntime = {
  now: () => new Date(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  sha256: async (input) => new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBuffer(input))),
  request: async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return { status: response.status, json: () => response.json() };
  },
};

const runtimeFor = (overrides: Partial<GoogleOAuthRuntime> | undefined): GoogleOAuthRuntime => ({
  ...defaultRuntime,
  ...overrides,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const validLoopbackRedirect = (value: string): boolean => {
  try {
    const url = new URL(value);
    const port = Number(url.port);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && Number.isInteger(port)
      && port >= 1
      && port <= 65_535
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
};

const randomValue = (
  runtime: GoogleOAuthRuntime,
  length: number,
): Effect.Effect<string, GoogleOAuthTokenError> =>
  Effect.try({
    try: () => {
      const value = runtime.randomBytes(length);
      if (value.byteLength !== length) throw new Error('invalid random value');
      return base64Url(value);
    },
    catch: () => new GoogleOAuthTokenError({
      operation: 'exchange',
      message: 'Unable to create the Google OAuth authorization request.',
    }),
  });

const codeChallenge = (
  runtime: GoogleOAuthRuntime,
  verifier: string,
): Effect.Effect<string, GoogleOAuthTokenError> =>
  Effect.tryPromise({
    try: async () => base64Url(await runtime.sha256(new TextEncoder().encode(verifier))),
    catch: () => new GoogleOAuthTokenError({
      operation: 'exchange',
      message: 'Unable to create the Google OAuth authorization request.',
    }),
  });

const callbackCode = (
  callbackUrl: string,
  redirectUri: string,
  state: string,
): Effect.Effect<string, GoogleOAuthCallbackError> => {
  let callback: URL;
  let redirect: URL;
  try {
    callback = new URL(callbackUrl);
    redirect = new URL(redirectUri);
  } catch {
    return Effect.fail(new GoogleOAuthCallbackError({
      reason: 'invalid-callback',
      message: 'Google OAuth returned an invalid callback URL.',
    }));
  }
  if (
    callback.protocol !== redirect.protocol
    || callback.hostname !== redirect.hostname
    || callback.port !== redirect.port
    || callback.pathname !== redirect.pathname
  ) {
    return Effect.fail(new GoogleOAuthCallbackError({
      reason: 'invalid-callback',
      message: 'Google OAuth callback did not match the pending redirect URI.',
    }));
  }
  if (callback.searchParams.get('state') !== state) {
    return Effect.fail(new GoogleOAuthCallbackError({
      reason: 'state-mismatch',
      message: 'Google OAuth callback state did not match the pending authorization request.',
    }));
  }
  if (callback.searchParams.has('error')) {
    return Effect.fail(new GoogleOAuthCallbackError({
      reason: 'denied',
      message: 'Google authorization was denied or cancelled.',
    }));
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    return Effect.fail(new GoogleOAuthCallbackError({
      reason: 'missing-code',
      message: 'Google OAuth callback did not include an authorization code.',
    }));
  }
  return Effect.succeed(code);
};

const requestToken = (
  runtime: GoogleOAuthRuntime,
  operation: Exclude<GoogleOAuthTokenOperation, 'revoke'>,
  body: URLSearchParams,
  fallbackRefreshToken: Redacted.Redacted<string> | undefined,
  fallbackScopes: readonly string[],
): Effect.Effect<GoogleOAuthToken, GoogleOAuthTokenError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => runtime.request({
        url: GOOGLE_TOKEN_ENDPOINT,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      catch: () => new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token request failed.',
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      return yield* new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token request was rejected.',
      });
    }
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token response was invalid.',
      }),
    });
    if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token) {
      return yield* new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token response was invalid.',
      });
    }
    const refreshToken = typeof payload.refresh_token === 'string' && payload.refresh_token
      ? Redacted.make(payload.refresh_token)
      : fallbackRefreshToken;
    if (refreshToken === undefined) {
      return yield* new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token response did not include a refresh token.',
      });
    }
    if (
      typeof payload.expires_in !== 'number'
      || !Number.isFinite(payload.expires_in)
      || payload.expires_in <= 0
    ) {
      return yield* new GoogleOAuthTokenError({
        operation,
        message: 'Google OAuth token response did not include a valid expiry.',
      });
    }
    const scopes = typeof payload.scope === 'string'
      ? payload.scope.split(' ').filter(Boolean)
      : fallbackScopes;
    return {
      accessToken: Redacted.make(payload.access_token),
      refreshToken,
      expiresAt: new Date(runtime.now().getTime() + Math.max(0, payload.expires_in * 1_000 - TOKEN_EXPIRY_SKEW_MS)),
      scopes,
    };
  });

const appendClientRegistration = (
  form: URLSearchParams,
  registration: GoogleOAuthClientRegistration,
): Effect.Effect<void, GoogleOAuthConfigurationError> => {
  if (!registration.clientId.trim()) {
    return Effect.fail(new GoogleOAuthConfigurationError({
      message: 'Google OAuth requires a client id.',
    }));
  }
  form.set('client_id', registration.clientId);
  if (registration.clientSecret !== undefined) {
    form.set('client_secret', Redacted.value(registration.clientSecret));
  }
  return Effect.void;
};

/** Start the documented Google installed-app loopback flow. The host opens `authorizationUrl` and owns the listener. */
export const createGoogleOAuthAuthorization = (
  input: GoogleOAuthAuthorizationOptions,
  overrides?: Partial<GoogleOAuthRuntime>,
): Effect.Effect<GoogleOAuthAuthorization, GoogleOAuthConfigurationError | GoogleOAuthTokenError> =>
  Effect.gen(function* () {
    if (!input.clientId.trim()) {
      return yield* new GoogleOAuthConfigurationError({ message: 'Google OAuth requires a client id.' });
    }
    if (!validLoopbackRedirect(input.redirectUri)) {
      return yield* new GoogleOAuthConfigurationError({
        message: 'Google OAuth requires an http://127.0.0.1 random-port loopback redirect URI.',
      });
    }
    const scopes = input.scopes.map((scope) => scope.trim());
    if (!scopes.length || scopes.some((scope) => !scope) || new Set(scopes).size !== scopes.length) {
      return yield* new GoogleOAuthConfigurationError({
        message: 'Google OAuth scopes must be non-empty and unique.',
      });
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      return yield* new GoogleOAuthConfigurationError({
        message: 'Google OAuth authorization timeout must be a positive integer.',
      });
    }
    const runtime = runtimeFor(overrides);
    const state = yield* randomValue(runtime, 32);
    const verifier = yield* randomValue(runtime, 64);
    const challenge = yield* codeChallenge(runtime, verifier);
    const authorization = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    authorization.searchParams.set('client_id', input.clientId);
    authorization.searchParams.set('redirect_uri', input.redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('scope', scopes.join(' '));
    authorization.searchParams.set('state', state);
    authorization.searchParams.set('access_type', 'offline');
    authorization.searchParams.set('code_challenge', challenge);
    authorization.searchParams.set('code_challenge_method', 'S256');
    const expiresAt = new Date(runtime.now().getTime() + timeoutMs);
    let used = false;
    return {
      authorizationUrl: authorization.toString(),
      expiresAt,
      complete: (callbackUrl) => {
        if (used) {
          return Effect.fail(new GoogleOAuthCallbackError({
            reason: 'reused',
            message: 'Google OAuth authorization has already been completed.',
          }));
        }
        if (runtime.now().getTime() >= expiresAt.getTime()) {
          return Effect.fail(new GoogleOAuthCallbackError({
            reason: 'expired',
            message: 'Google OAuth authorization timed out.',
          }));
        }
        return callbackCode(callbackUrl, input.redirectUri, state).pipe(
          Effect.flatMap((code) => {
            used = true;
            const body = new URLSearchParams({
              code,
              code_verifier: verifier,
              grant_type: 'authorization_code',
              redirect_uri: input.redirectUri,
            });
            body.set('client_id', input.clientId);
            if (input.clientSecret !== undefined) {
              body.set('client_secret', Redacted.value(input.clientSecret));
            }
            return requestToken(runtime, 'exchange', body, undefined, scopes);
          }),
        );
      },
    };
  });

/** Refresh a Google credential while retaining its prior refresh token when Google does not rotate it. */
export const refreshGoogleOAuthToken = (
  token: GoogleOAuthToken,
  registration: GoogleOAuthClientRegistration,
  overrides?: Partial<GoogleOAuthRuntime>,
): Effect.Effect<GoogleOAuthToken, GoogleOAuthConfigurationError | GoogleOAuthTokenError> => {
  const runtime = runtimeFor(overrides);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: Redacted.value(token.refreshToken),
  });
  return appendClientRegistration(body, registration).pipe(
    Effect.flatMap(() => requestToken(runtime, 'refresh', body, token.refreshToken, token.scopes)),
  );
};

/** Refresh once with an optimistic encrypted-store write; a CAS loser reloads the winning credential. */
export const refreshGoogleOAuthTokenWithStore = <E>(
  store: GoogleOAuthRefreshStore<E>,
  registration: GoogleOAuthClientRegistration,
  overrides?: Partial<GoogleOAuthRuntime>,
): Effect.Effect<GoogleOAuthToken, GoogleOAuthRefreshError<E>> =>
  Effect.gen(function* () {
    const current = yield* store.load();
    const refreshed = yield* refreshGoogleOAuthToken(current.token, registration, overrides);
    if (yield* store.compareAndSet(current.version, refreshed)) return refreshed;
    return (yield* store.load()).token;
  });

/** Share one in-process refresh per connection adapter while its CAS protects concurrent processes. */
export const makeGoogleOAuthRefreshCoordinator = <E>(
  store: GoogleOAuthRefreshStore<E>,
  registration: GoogleOAuthClientRegistration,
  overrides?: Partial<GoogleOAuthRuntime>,
): Effect.Effect<GoogleOAuthRefreshCoordinator<E>> =>
  Effect.gen(function* () {
    const pending = yield* Ref.make(Option.none<Deferred.Deferred<GoogleOAuthToken, GoogleOAuthRefreshError<E>>>());
    const refresh: GoogleOAuthRefreshCoordinator<E>['refresh'] = () => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
      const next = yield* Deferred.make<GoogleOAuthToken, GoogleOAuthRefreshError<E>>();
      const selected = yield* Ref.modify(pending, (current): readonly [{ readonly owner: boolean; readonly deferred: Deferred.Deferred<GoogleOAuthToken, GoogleOAuthRefreshError<E>> }, Option.Option<Deferred.Deferred<GoogleOAuthToken, GoogleOAuthRefreshError<E>>>] => {
        if (Option.isSome(current)) return [{ owner: false, deferred: current.value }, current];
        return [{ owner: true, deferred: next }, Option.some(next)];
      });
      if (selected.owner) {
        const worker = Effect.intoDeferred(
          restore(refreshGoogleOAuthTokenWithStore(store, registration, overrides)),
          selected.deferred,
        ).pipe(Effect.ensuring(Ref.set(pending, Option.none())));
        yield* Effect.forkDaemon(worker);
      }
      return yield* restore(Deferred.await(selected.deferred));
    }));
    return { refresh };
  });

/** Revoke a Google access or refresh token. The caller retains local credentials when this remote request fails. */
export const revokeGoogleOAuthToken = (
  token: Redacted.Redacted<string>,
  overrides?: Partial<GoogleOAuthRuntime>,
): Effect.Effect<void, GoogleOAuthTokenError> => {
  const runtime = runtimeFor(overrides);
  return Effect.tryPromise({
    try: () => runtime.request({
      url: GOOGLE_REVOCATION_ENDPOINT,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: Redacted.value(token) }).toString(),
    }),
    catch: () => new GoogleOAuthTokenError({
      operation: 'revoke',
      message: 'Google OAuth revocation request failed.',
    }),
  }).pipe(
    Effect.flatMap((response) => response.status >= 200 && response.status < 300
      ? Effect.void
      : Effect.fail(new GoogleOAuthTokenError({
        operation: 'revoke',
        message: 'Google OAuth revocation request was rejected.',
      }))),
  );
};

/** Convert the token only at the encrypted provider-connection persistence boundary. */
export const googleOAuthCredentials = (token: GoogleOAuthToken): ProviderConnectionCredentials => ({
  kind: 'oauth2-bearer',
  accessToken: token.accessToken,
  refreshToken: token.refreshToken,
});
