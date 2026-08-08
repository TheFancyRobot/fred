import { Buffer } from 'node:buffer';
import { Data, Effect, Redacted } from 'effect';
import type { ProviderConnectionCredentials } from '@fancyrobot/fred';

const OPENROUTER_AUTHORIZATION_ENDPOINT = 'https://openrouter.ai/auth';
const OPENROUTER_KEY_EXCHANGE_ENDPOINT = 'https://openrouter.ai/api/v1/auth/keys';
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1_000;

export type OpenRouterOAuthCallbackReason =
  | 'denied'
  | 'expired'
  | 'invalid-callback'
  | 'missing-code'
  | 'reused'
  | 'state-mismatch';

export class OpenRouterOAuthConfigurationError extends Data.TaggedError(
  'OpenRouterOAuthConfigurationError',
)<{ readonly message: string }> {}

/** A callback was not the pending authorization response. It never retains the authorization code. */
export class OpenRouterOAuthCallbackError extends Data.TaggedError(
  'OpenRouterOAuthCallbackError',
)<{ readonly reason: OpenRouterOAuthCallbackReason; readonly message: string }> {}

/** OpenRouter exchange failures intentionally omit response bodies, codes, verifiers, and API keys. */
export class OpenRouterOAuthExchangeError extends Data.TaggedError(
  'OpenRouterOAuthExchangeError',
)<{ readonly message: string }> {}

export interface OpenRouterOAuthHttpRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface OpenRouterOAuthHttpResponse {
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

/** Injectable seams keep PKCE exchange tests deterministic and leave browser/listener ownership with the host. */
export interface OpenRouterOAuthRuntime {
  readonly now: () => Date;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly sha256: (input: Uint8Array) => Promise<Uint8Array>;
  readonly request: (request: OpenRouterOAuthHttpRequest) => Promise<OpenRouterOAuthHttpResponse>;
}

export interface OpenRouterOAuthOptions {
  /** When omitted, OpenRouter's documented headless mode displays a one-time code for the user to paste. */
  readonly callbackUrl?: string;
  readonly keyLabel?: string;
}

export interface OpenRouterOAuthApiKey {
  readonly apiKey: Redacted.Redacted<string>;
}

export type OpenRouterOAuthAuthorization =
  | {
    readonly mode: 'callback';
    readonly authorizationUrl: string;
    readonly expiresAt: Date;
    readonly completeCallback: (
      callbackUrl: string,
    ) => Effect.Effect<OpenRouterOAuthApiKey, OpenRouterOAuthCallbackError | OpenRouterOAuthExchangeError>;
  }
  | {
    readonly mode: 'headless';
    readonly authorizationUrl: string;
    readonly expiresAt: Date;
    readonly completeCode: (
      code: string,
    ) => Effect.Effect<OpenRouterOAuthApiKey, OpenRouterOAuthCallbackError | OpenRouterOAuthExchangeError>;
  };

const arrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const base64Url = (value: Uint8Array): string => Buffer.from(value).toString('base64url');

const defaultRuntime: OpenRouterOAuthRuntime = {
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

const runtimeFor = (overrides: Partial<OpenRouterOAuthRuntime> | undefined): OpenRouterOAuthRuntime => ({
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
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
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
  runtime: OpenRouterOAuthRuntime,
  length: number,
): Effect.Effect<string, OpenRouterOAuthExchangeError> =>
  Effect.try({
    try: () => {
      const value = runtime.randomBytes(length);
      if (value.byteLength !== length) throw new Error('invalid random value');
      return base64Url(value);
    },
    catch: () => new OpenRouterOAuthExchangeError({
      message: 'Unable to create the OpenRouter authorization request.',
    }),
  });

const codeChallenge = (
  runtime: OpenRouterOAuthRuntime,
  verifier: string,
): Effect.Effect<string, OpenRouterOAuthExchangeError> =>
  Effect.tryPromise({
    try: async () => base64Url(await runtime.sha256(new TextEncoder().encode(verifier))),
    catch: () => new OpenRouterOAuthExchangeError({
      message: 'Unable to create the OpenRouter authorization request.',
    }),
  });

const exchangeCode = (
  runtime: OpenRouterOAuthRuntime,
  code: string,
  verifier: string,
): Effect.Effect<OpenRouterOAuthApiKey, OpenRouterOAuthExchangeError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => runtime.request({
        url: OPENROUTER_KEY_EXCHANGE_ENDPOINT,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          code_challenge_method: 'S256',
        }),
      }),
      catch: () => new OpenRouterOAuthExchangeError({
        message: 'OpenRouter key exchange failed.',
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      return yield* new OpenRouterOAuthExchangeError({
        message: 'OpenRouter key exchange was rejected.',
      });
    }
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new OpenRouterOAuthExchangeError({
        message: 'OpenRouter key exchange response was invalid.',
      }),
    });
    if (!isRecord(payload) || typeof payload.key !== 'string' || !payload.key) {
      return yield* new OpenRouterOAuthExchangeError({
        message: 'OpenRouter key exchange response was invalid.',
      });
    }
    return { apiKey: Redacted.make(payload.key) };
  });

const callbackCode = (
  callbackUrl: string,
  expectedCallbackUrl: string,
  state: string,
): Effect.Effect<string, OpenRouterOAuthCallbackError> => {
  let callback: URL;
  let expected: URL;
  try {
    callback = new URL(callbackUrl);
    expected = new URL(expectedCallbackUrl);
  } catch {
    return Effect.fail(new OpenRouterOAuthCallbackError({
      reason: 'invalid-callback',
      message: 'OpenRouter returned an invalid callback URL.',
    }));
  }
  if (
    callback.protocol !== expected.protocol
    || callback.hostname !== expected.hostname
    || callback.port !== expected.port
    || callback.pathname !== expected.pathname
  ) {
    return Effect.fail(new OpenRouterOAuthCallbackError({
      reason: 'invalid-callback',
      message: 'OpenRouter callback did not match the pending redirect URI.',
    }));
  }
  if (callback.searchParams.get('state') !== state) {
    return Effect.fail(new OpenRouterOAuthCallbackError({
      reason: 'state-mismatch',
      message: 'OpenRouter callback state did not match the pending authorization request.',
    }));
  }
  if (callback.searchParams.has('error')) {
    return Effect.fail(new OpenRouterOAuthCallbackError({
      reason: 'denied',
      message: 'OpenRouter authorization was denied or cancelled.',
    }));
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    return Effect.fail(new OpenRouterOAuthCallbackError({
      reason: 'missing-code',
      message: 'OpenRouter callback did not include an authorization code.',
    }));
  }
  return Effect.succeed(code);
};

const authorizationUrl = (
  verifierChallenge: string,
  callbackUrl: string | undefined,
  keyLabel: string | undefined,
): string => {
  const authorization = new URL(OPENROUTER_AUTHORIZATION_ENDPOINT);
  authorization.searchParams.set('code_challenge', verifierChallenge);
  authorization.searchParams.set('code_challenge_method', 'S256');
  if (callbackUrl !== undefined) authorization.searchParams.set('callback_url', callbackUrl);
  if (keyLabel !== undefined) authorization.searchParams.set('key_label', keyLabel);
  return authorization.toString();
};

/** Start the documented OpenRouter PKCE flow. OpenRouter returns a reusable API key, not OAuth bearer tokens. */
export const createOpenRouterOAuthAuthorization = (
  input: OpenRouterOAuthOptions = {},
  overrides?: Partial<OpenRouterOAuthRuntime>,
): Effect.Effect<
  OpenRouterOAuthAuthorization,
  OpenRouterOAuthConfigurationError | OpenRouterOAuthExchangeError
> =>
  Effect.gen(function* () {
    if (input.callbackUrl !== undefined && !validLoopbackRedirect(input.callbackUrl)) {
      return yield* new OpenRouterOAuthConfigurationError({
        message: 'OpenRouter OAuth callbacks require an http localhost loopback redirect URI.',
      });
    }
    if (input.keyLabel !== undefined && !input.keyLabel.trim()) {
      return yield* new OpenRouterOAuthConfigurationError({
        message: 'OpenRouter OAuth key labels must not be blank.',
      });
    }
    const runtime = runtimeFor(overrides);
    const verifier = yield* randomValue(runtime, 64);
    const challenge = yield* codeChallenge(runtime, verifier);
    const expiresAt = new Date(runtime.now().getTime() + AUTHORIZATION_CODE_TTL_MS);
    let used = false;
    const complete = (code: string): Effect.Effect<OpenRouterOAuthApiKey, OpenRouterOAuthCallbackError | OpenRouterOAuthExchangeError> => {
      if (used) {
        return Effect.fail(new OpenRouterOAuthCallbackError({
          reason: 'reused',
          message: 'OpenRouter authorization has already been completed.',
        }));
      }
      if (runtime.now().getTime() >= expiresAt.getTime()) {
        return Effect.fail(new OpenRouterOAuthCallbackError({
          reason: 'expired',
          message: 'OpenRouter authorization code expired.',
        }));
      }
      if (!code.trim()) {
        return Effect.fail(new OpenRouterOAuthCallbackError({
          reason: 'missing-code',
          message: 'OpenRouter authorization did not include a code.',
        }));
      }
      used = true;
      return exchangeCode(runtime, code, verifier);
    };
    if (input.callbackUrl === undefined) {
      return {
        mode: 'headless',
        authorizationUrl: authorizationUrl(challenge, undefined, input.keyLabel),
        expiresAt,
        completeCode: complete,
      };
    }
    const state = yield* randomValue(runtime, 32);
    const callback = new URL(input.callbackUrl);
    if (callback.searchParams.has('state')) {
      return yield* new OpenRouterOAuthConfigurationError({
        message: 'OpenRouter OAuth callback URLs must not supply their own state parameter.',
      });
    }
    callback.searchParams.set('state', state);
    const expectedCallbackUrl = callback.toString();
    return {
      mode: 'callback',
      authorizationUrl: authorizationUrl(challenge, expectedCallbackUrl, input.keyLabel),
      expiresAt,
      completeCallback: (receivedCallbackUrl) => callbackCode(
        receivedCallbackUrl,
        expectedCallbackUrl,
        state,
      ).pipe(Effect.flatMap(complete)),
    };
  });

/** Convert the returned user-controlled key only at the encrypted provider-connection persistence boundary. */
export const openRouterOAuthCredentials = (
  result: OpenRouterOAuthApiKey,
): ProviderConnectionCredentials => ({
  kind: 'api-key',
  apiKey: result.apiKey,
});
