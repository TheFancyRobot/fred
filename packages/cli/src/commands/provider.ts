import { Effect, Option, Redacted, Schema } from 'effect';
import {
  BUILTIN_PROVIDER_CONNECTION_CAPABILITIES,
  LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
  ProviderConnectionTestError,
  decodeProviderConnectionId,
  decodeProviderConnectionNamespace,
  testProviderConnectionDraft,
  validateProviderConnectionCapability,
  type ProviderConnection,
  type ProviderConnectionAuthKind,
  type ProviderConnectionCapabilities,
  type ProviderConnectionCredentials,
  type ProviderConnectionDraft,
  type ProviderConnectionId,
  type ProviderConnectionProtocol,
} from '@fancyrobot/fred';
import { sanitizeErrorForCli } from './error-sanitize.js';

const GOOGLE_LOGIN_METHOD = 'google-installed-app';
const OPENROUTER_LOGIN_METHOD = 'openrouter-pkce-api-key';

export class ProviderCommandError extends Schema.TaggedError<ProviderCommandError>()(
  'ProviderCommandError',
  { code: Schema.String, message: Schema.String },
) {}

export interface ProviderConnectionRecord {
  readonly connection: ProviderConnection;
  readonly credentials: ProviderConnectionCredentials;
  readonly expiresAt?: Date;
}

/** The CLI needs decrypted credentials only for test/logout; it never renders them. */
export interface ProviderConnectionCommandStore {
  readonly list: () => Promise<readonly ProviderConnection[]>;
  readonly get: (id: ProviderConnectionId) => Promise<ProviderConnectionRecord | null>;
  readonly save: (
    connection: ProviderConnection,
    credentials: ProviderConnectionCredentials,
    expiresAt?: Date,
  ) => Promise<void>;
  readonly remove: (id: ProviderConnectionId) => Promise<boolean>;
  readonly metadata: (id: ProviderConnectionId) => Promise<{ readonly expiresAt?: Date } | null>;
}

export interface ProviderConnectionCommandStoreLease {
  readonly store: ProviderConnectionCommandStore;
  readonly close: () => Promise<void>;
}

export interface ProviderCommandIO {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface ProviderLoginResult {
  readonly credentials: ProviderConnectionCredentials;
  readonly expiresAt?: Date;
}

export interface ProviderCommandDependencies {
  readonly io?: ProviderCommandIO;
  readonly openStore?: () => Promise<ProviderConnectionCommandStoreLease>;
  readonly readSecret?: (prompt: string, requireStdinFlag: boolean) => Promise<string>;
  readonly testConnection?: (
    draft: ProviderConnectionDraft,
    credentials: ProviderConnectionCredentials,
  ) => Promise<void>;
  readonly login?: (
    draft: ProviderConnectionDraft,
    options: Record<string, unknown>,
    io: ProviderCommandIO,
  ) => Promise<ProviderLoginResult>;
  readonly revoke?: (record: ProviderConnectionRecord) => Promise<void>;
}

const DEFAULT_IO: ProviderCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const commandError = (code: string, message: string) => new ProviderCommandError({ code, message });

const parseProvider = (raw: string | undefined): Effect.Effect<string, ProviderCommandError> => {
  const providerId = raw?.trim().toLowerCase();
  return providerId
    ? Effect.succeed(providerId)
    : Effect.fail(commandError('usage', 'A provider id is required.'));
};

const capabilityFor = (providerId: string): Effect.Effect<ProviderConnectionCapabilities, ProviderCommandError> => {
  if (providerId === LOCAL_PROVIDER_CONNECTION_CAPABILITIES.providerId) {
    return Effect.succeed(LOCAL_PROVIDER_CONNECTION_CAPABILITIES);
  }
  const capability = BUILTIN_PROVIDER_CONNECTION_CAPABILITIES.find((candidate) => candidate.providerId === providerId);
  return capability
    ? Effect.succeed(capability)
    : Effect.fail(commandError('usage', `Unknown provider "${providerId}".`));
};

const parseAuth = (
  raw: unknown,
  capabilities: ProviderConnectionCapabilities,
): Effect.Effect<ProviderConnectionAuthKind, ProviderCommandError> => {
  if (raw === undefined && capabilities.auth.length === 1) return Effect.succeed(capabilities.auth[0]!);
  if (raw === 'none' || raw === 'api-key' || raw === 'basic' || raw === 'oauth2-bearer') {
    return capabilities.auth.includes(raw)
      ? Effect.succeed(raw)
      : Effect.fail(commandError('usage', `Provider "${capabilities.providerId}" does not support ${raw} authentication.`));
  }
  return Effect.fail(commandError(
    'usage',
    `Specify --auth ${capabilities.auth.join('|')} for provider "${capabilities.providerId}".`,
  ));
};

const parseProtocol = (
  raw: unknown,
  capabilities: ProviderConnectionCapabilities,
): Effect.Effect<ProviderConnectionProtocol | undefined, ProviderCommandError> => {
  if (raw === undefined) return Effect.as(Effect.void, undefined);
  if (raw !== 'openai-compatible' && raw !== 'anthropic-compatible') {
    return Effect.fail(commandError('usage', '--protocol must be openai-compatible or anthropic-compatible.'));
  }
  return capabilities.protocols?.includes(raw)
    ? Effect.succeed(raw)
    : Effect.fail(commandError('usage', `Provider "${capabilities.providerId}" does not support ${raw}.`));
};

const parseEndpoint = (raw: unknown): Effect.Effect<string | undefined, ProviderCommandError> => {
  if (raw === undefined) return Effect.as(Effect.void, undefined);
  if (typeof raw !== 'string') return Effect.fail(commandError('usage', '--endpoint must be an http(s) URL.'));
  return Effect.try({
    try: () => {
      const endpoint = new URL(raw);
      if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('invalid endpoint');
      return endpoint.toString();
    },
    catch: () => commandError('usage', '--endpoint must be an http(s) URL.'),
  });
};

const connectionDraft = (
  providerId: string,
  label: string | undefined,
  auth: ProviderConnectionAuthKind,
  endpoint: string | undefined,
  protocol: ProviderConnectionProtocol | undefined,
): Effect.Effect<ProviderConnectionDraft, ProviderCommandError> => {
  const normalizedLabel = label?.trim();
  if (!normalizedLabel) return Effect.fail(commandError('usage', 'A non-empty connection label is required.'));
  return Effect.succeed({
    label: normalizedLabel,
    providerId,
    auth: { kind: auth },
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(protocol === undefined ? {} : { protocol }),
  });
};

const credentialsFor = (
  auth: ProviderConnectionAuthKind,
  options: Record<string, unknown>,
  deps: ProviderCommandDependencies,
): Effect.Effect<ProviderConnectionCredentials, ProviderCommandError> => {
  if (auth === 'none') return Effect.succeed({ kind: 'none' });
  if (auth === 'oauth2-bearer') {
    return Effect.fail(commandError('usage', 'OAuth bearer credentials must be created with `fred provider login google <label>`.'));
  }
  const readSecret = deps.readSecret ?? readSecretFromTerminal;
  const requireStdinFlag = options['secret-stdin'] === true;
  return Effect.gen(function* () {
    const secret = yield* Effect.tryPromise({
      try: () => readSecret(auth === 'basic' ? 'Password: ' : 'API key: ', requireStdinFlag),
      catch: () => commandError('cancelled', 'Secret input was cancelled.'),
    });
    if (!secret.trim()) return yield* commandError('usage', 'Secret input must not be empty.');
    if (auth === 'api-key') {
      const credentials: ProviderConnectionCredentials = { kind: 'api-key', apiKey: Redacted.make(secret) };
      return credentials;
    }
    const username = typeof options.username === 'string' ? options.username.trim() : '';
    if (!username) return yield* commandError('usage', 'Basic authentication requires --username <name>.');
    const credentials: ProviderConnectionCredentials = {
      kind: 'basic',
      username: Redacted.make(username),
      password: Redacted.make(secret),
    };
    return credentials;
  });
};

const defaultConnectionTest = (
  draft: ProviderConnectionDraft,
  credentials: ProviderConnectionCredentials,
): Promise<void> => Effect.runPromise(Effect.either(testProviderConnectionDraft(draft, credentials))).then((result) => {
  if (result._tag === 'Left') throw result.left;
});

const testDraft = (
  draft: ProviderConnectionDraft,
  credentials: ProviderConnectionCredentials,
  deps: ProviderCommandDependencies,
): Effect.Effect<void, ProviderCommandError> =>
  Effect.tryPromise({
    try: () => (deps.testConnection ?? defaultConnectionTest)(draft, credentials),
    catch: (error) => commandError(
      'connectivity',
      error instanceof ProviderConnectionTestError ? error.message : 'Provider connection test failed.',
    ),
  });

const metadataFor = (connection: ProviderConnection, expiresAt?: Date) => ({
  id: connection.id,
  label: connection.label,
  provider: connection.providerId,
  endpointHost: connection.endpoint === undefined ? null : new URL(connection.endpoint).host,
  auth: connection.auth.kind,
  status: connection.status,
  expiresAt: expiresAt?.toISOString() ?? null,
});

const formatMetadata = (connection: ProviderConnection, expiresAt?: Date): string => {
  const metadata = metadataFor(connection, expiresAt);
  return [
    `${metadata.label} (${metadata.provider})`,
    `  id: ${metadata.id}`,
    `  endpoint: ${metadata.endpointHost ?? '-'}`,
    `  auth: ${metadata.auth}`,
    `  status: ${metadata.status}`,
    `  expires: ${metadata.expiresAt ?? '-'}`,
  ].join('\n');
};

const emit = (io: ProviderCommandIO, options: Record<string, unknown>, payload: unknown, text: string): void => {
  io.stdout(options.json === true ? JSON.stringify(payload, null, 2) : text);
};

const getRecord = (
  id: ProviderConnectionId,
  store: ProviderConnectionCommandStore,
): Effect.Effect<ProviderConnectionRecord, ProviderCommandError> =>
  Effect.tryPromise({
    try: () => store.get(id),
    catch: () => commandError('internal', 'Unable to read provider connection.'),
  }).pipe(
    Effect.flatMap((record) => record === null
      ? Effect.fail(commandError('not-found', `Provider connection "${id}" was not found.`))
      : Effect.succeed(record)),
  );

const defaultRevoke = async (record: ProviderConnectionRecord): Promise<void> => {
  if (record.connection.providerId !== 'google' || record.credentials.kind !== 'oauth2-bearer') return;
  const google = await import('@fancyrobot/fred-google');
  await Effect.runPromise(google.revokeGoogleOAuthToken(record.credentials.refreshToken ?? record.credentials.accessToken));
};

const defaultLogin = async (
  draft: ProviderConnectionDraft,
  options: Record<string, unknown>,
  io: ProviderCommandIO,
): Promise<ProviderLoginResult> => {
  const loopback = await createLoopbackCallback();
  try {
    if (draft.providerId === 'google') {
      const clientId = process.env.FRED_GOOGLE_OAUTH_CLIENT_ID?.trim();
      const scopes = process.env.FRED_GOOGLE_OAUTH_SCOPES?.split(',').map((scope) => scope.trim()).filter(Boolean) ?? [];
      if (!clientId || scopes.length === 0) {
        throw new Error('Google login requires FRED_GOOGLE_OAUTH_CLIENT_ID and FRED_GOOGLE_OAUTH_SCOPES.');
      }
      const google = await import('@fancyrobot/fred-google');
      const authorization = await Effect.runPromise(google.createGoogleOAuthAuthorization({
        clientId,
        redirectUri: loopback.callbackUrl,
        scopes,
      }));
      io.stdout(`Open this URL to continue Google login:\n${authorization.authorizationUrl}`);
      await openBrowser(authorization.authorizationUrl);
      const token = await Effect.runPromise(authorization.complete(await loopback.wait(authorization.expiresAt.getTime() - Date.now())));
      return { credentials: google.googleOAuthCredentials(token), expiresAt: token.expiresAt };
    }

    if (draft.providerId === 'openrouter') {
      const openrouter = await import('@fancyrobot/fred-openrouter');
      const authorization = await Effect.runPromise(openrouter.createOpenRouterOAuthAuthorization({
        ...(options.headless === true ? {} : { callbackUrl: loopback.callbackUrl }),
        keyLabel: draft.label,
      }));
      io.stdout(`Open this URL to continue OpenRouter login:\n${authorization.authorizationUrl}`);
      await openBrowser(authorization.authorizationUrl);
      const result = authorization.mode === 'headless'
        ? await Effect.runPromise(authorization.completeCode(await readSecretFromTerminal('OpenRouter authorization code: ', false)))
        : await Effect.runPromise(authorization.completeCallback(await loopback.wait(authorization.expiresAt.getTime() - Date.now())));
      return { credentials: openrouter.openRouterOAuthCredentials(result) };
    }

    throw new Error(`Provider "${draft.providerId}" does not support OAuth login.`);
  } finally {
    loopback.close();
  }
};

const executeProviderCommand = (
  args: readonly string[],
  options: Record<string, unknown>,
  store: ProviderConnectionCommandStore,
  deps: ProviderCommandDependencies,
  io: ProviderCommandIO,
): Effect.Effect<number, ProviderCommandError> => {
  const operation = args[0];

  if (operation === 'list') {
    return Effect.tryPromise({
      try: () => store.list(),
      catch: () => commandError('internal', 'Unable to list provider connections.'),
    }).pipe(Effect.map((connections) => {
      const metadata = connections.map((connection) => metadataFor(connection));
      emit(io, options, { ok: true, command: 'provider list', data: metadata }, metadata.length === 0
        ? 'No provider connections.'
        : metadata.map((entry) => formatMetadata(connections.find((connection) => connection.id === entry.id)!)).join('\n\n'));
      return 0;
    }));
  }

  if (operation === 'add') {
    return Effect.gen(function* () {
      const providerId = yield* parseProvider(args[1]);
      const capabilities = yield* capabilityFor(providerId);
      const auth = yield* parseAuth(options.auth, capabilities);
      const endpoint = yield* parseEndpoint(options.endpoint);
      const protocol = yield* parseProtocol(options.protocol, capabilities);
      if (providerId === LOCAL_PROVIDER_CONNECTION_CAPABILITIES.providerId && protocol === undefined) {
        return yield* commandError('usage', 'Local compatible connections require --protocol openai-compatible or anthropic-compatible.');
      }
      const draft = yield* connectionDraft(providerId, args[2], auth, endpoint, protocol);
      yield* validateProviderConnectionCapability(draft, capabilities).pipe(
        Effect.mapError((error) => commandError('usage', error.message)),
      );
      const credentials = yield* credentialsFor(auth, options, deps);
      if (options.test === true) yield* testDraft(draft, credentials, deps);
      const id = yield* decodeProviderConnectionId(crypto.randomUUID()).pipe(
        Effect.mapError((error) => commandError('internal', error.message)),
      );
      const connection: ProviderConnection = { ...draft, id, status: 'active' };
      yield* Effect.tryPromise({
        try: () => store.save(connection, credentials),
        catch: () => commandError('internal', 'Unable to save provider connection.'),
      });
      emit(io, options, { ok: true, command: 'provider add', data: metadataFor(connection) }, `Saved provider connection "${connection.label}".`);
      return 0;
    });
  }

  if (operation === 'test') {
    return Effect.gen(function* () {
      const id = yield* decodeProviderConnectionId(args[1]).pipe(Effect.mapError((error) => commandError('usage', error.message)));
      const record = yield* getRecord(id, store);
      const capabilities = yield* capabilityFor(record.connection.providerId);
      const draft: ProviderConnectionDraft = {
        label: record.connection.label,
        providerId: record.connection.providerId,
        auth: record.connection.auth,
        ...(record.connection.endpoint === undefined ? {} : { endpoint: record.connection.endpoint }),
        ...(record.connection.protocol === undefined ? {} : { protocol: record.connection.protocol }),
      };
      yield* validateProviderConnectionCapability(draft, capabilities).pipe(
        Effect.mapError((error) => commandError('usage', error.message)),
      );
      yield* testDraft(draft, record.credentials, deps);
      emit(io, options, { ok: true, command: 'provider test', data: { id } }, `Provider connection "${record.connection.label}" is reachable.`);
      return 0;
    });
  }

  if (operation === 'status') {
    return Effect.gen(function* () {
      const id = yield* decodeProviderConnectionId(args[1]).pipe(Effect.mapError((error) => commandError('usage', error.message)));
      const record = yield* getRecord(id, store);
      const metadata = yield* Effect.tryPromise({
        try: () => store.metadata(id),
        catch: () => commandError('internal', 'Unable to read provider connection status.'),
      });
      const data = metadataFor(record.connection, metadata?.expiresAt);
      emit(io, options, { ok: true, command: 'provider status', data }, formatMetadata(record.connection, metadata?.expiresAt));
      return 0;
    });
  }

  if (operation === 'remove') {
    return Effect.gen(function* () {
      const id = yield* decodeProviderConnectionId(args[1]).pipe(Effect.mapError((error) => commandError('usage', error.message)));
      const removed = yield* Effect.tryPromise({
        try: () => store.remove(id),
        catch: () => commandError('internal', 'Unable to remove provider connection.'),
      });
      if (!removed) return yield* commandError('not-found', `Provider connection "${id}" was not found.`);
      emit(io, options, { ok: true, command: 'provider remove', data: { id } }, 'Provider connection removed.');
      return 0;
    });
  }

  if (operation === 'logout') {
    return Effect.gen(function* () {
      const id = yield* decodeProviderConnectionId(args[1]).pipe(Effect.mapError((error) => commandError('usage', error.message)));
      const record = yield* getRecord(id, store);
      const revoke = deps.revoke ?? defaultRevoke;
      yield* Effect.tryPromise({
        try: () => revoke(record),
        catch: () => commandError('connectivity', 'Remote credential revocation failed.'),
      });
      const removed = yield* Effect.tryPromise({
        try: () => store.remove(id),
        catch: () => commandError('internal', 'Unable to remove local provider credentials.'),
      });
      if (!removed) return yield* commandError('not-found', `Provider connection "${id}" was not found.`);
      emit(io, options, { ok: true, command: 'provider logout', data: { id } }, 'Local provider credentials removed.');
      return 0;
    });
  }

  if (operation === 'login') {
    return Effect.gen(function* () {
      const providerId = yield* parseProvider(args[1]);
      const capabilities = yield* capabilityFor(providerId);
      const loginMethod = providerId === 'google' ? GOOGLE_LOGIN_METHOD
        : providerId === 'openrouter' ? OPENROUTER_LOGIN_METHOD
          : undefined;
      if (loginMethod === undefined) return yield* commandError('usage', `Provider "${providerId}" does not support OAuth login.`);
      const auth: ProviderConnectionAuthKind = providerId === 'google' ? 'oauth2-bearer' : 'api-key';
      const draft = yield* connectionDraft(providerId, args[2], auth, undefined, undefined);
      yield* validateProviderConnectionCapability(draft, capabilities, loginMethod).pipe(
        Effect.mapError((error) => commandError('usage', error.message)),
      );
      const login = deps.login ?? defaultLogin;
      const result = yield* Effect.tryPromise({
        try: () => login(draft, options, io),
        catch: (error) => commandError('connectivity', sanitizeErrorForCli(error)),
      });
      if (result.credentials.kind !== draft.auth.kind) {
        return yield* commandError(
          'internal',
          `Provider "${providerId}" login returned ${result.credentials.kind} credentials but the connection requires ${draft.auth.kind}.`,
        );
      }
      const id = yield* decodeProviderConnectionId(crypto.randomUUID()).pipe(
        Effect.mapError((error) => commandError('internal', error.message)),
      );
      const connection: ProviderConnection = { ...draft, id, status: 'active' };
      yield* Effect.tryPromise({
        try: () => store.save(connection, result.credentials, result.expiresAt),
        catch: () => commandError('internal', 'Unable to save provider connection.'),
      });
      emit(io, options, { ok: true, command: 'provider login', data: metadataFor(connection, result.expiresAt) }, `Saved provider connection "${connection.label}".`);
      return 0;
    });
  }

  return Effect.fail(commandError('usage', 'Usage: fred provider add|list|test|login|status|logout|remove ...'));
};

const defaultOpenStore = async (): Promise<ProviderConnectionCommandStoreLease> => {
  const connectionString = process.env.FRED_POSTGRES_URL;
  const encodedKey = process.env.FRED_PROVIDER_CREDENTIAL_KEY;
  const namespaceValue = process.env.FRED_PROVIDER_CONNECTION_NAMESPACE;
  if (!connectionString) throw new Error('FRED_POSTGRES_URL is required for provider connection commands.');
  if (!encodedKey) throw new Error('FRED_PROVIDER_CREDENTIAL_KEY is required and must contain a base64url AES-256 key.');
  if (!namespaceValue) throw new Error('FRED_PROVIDER_CONNECTION_NAMESPACE is required for provider connection commands.');
  const namespace = await Effect.runPromise(decodeProviderConnectionNamespace(namespaceValue));
  const key = Buffer.from(encodedKey, 'base64url');
  if (key.byteLength !== 32) throw new Error('FRED_PROVIDER_CREDENTIAL_KEY must decode to exactly 32 bytes.');
  const [{ Pool }, postgres] = await Promise.all([import('pg'), import('@fancyrobot/fred-postgres')]);
  const pool = new Pool({ connectionString });
  try {
    const database = await Effect.runPromise(postgres.makeFredPostgres({ pool, schema: process.env.FRED_POSTGRES_SCHEMA }));
    await Effect.runPromise(postgres.migrateFredPostgresProviderConnections(database));
    const store = postgres.makePostgresProviderConnectionStore({
      pool,
      schema: process.env.FRED_POSTGRES_SCHEMA,
      keyRing: postgres.makeProviderCredentialKeyRing([{
        id: process.env.FRED_PROVIDER_CREDENTIAL_KEY_ID?.trim() || 'default',
        key: Redacted.make(key),
      }], process.env.FRED_PROVIDER_CREDENTIAL_KEY_ID?.trim() || 'default'),
    });
    return {
      store: {
        list: () => Effect.runPromise(store.list(namespace)),
        get: async (id) => Option.getOrNull(await Effect.runPromise(store.get(namespace, id))),
        save: (connection, credentials, expiresAt) => Effect.runPromise(store.save(namespace, connection, credentials, expiresAt)),
        remove: (id) => Effect.runPromise(store.remove(namespace, id)),
        metadata: async (id) => {
          const metadata = Option.getOrNull(await Effect.runPromise(store.getMetadata(namespace, id)));
          return metadata === null ? null : { expiresAt: metadata.expiresAt };
        },
      },
      close: () => Effect.runPromise(store.close).catch(() => pool.end()),
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
};

async function readSecretFromTerminal(prompt: string, requireStdinFlag: boolean): Promise<string> {
  if (!process.stdin.isTTY) {
    if (!requireStdinFlag) throw new Error('Piped secrets require --secret-stdin.');
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  if (typeof process.stdin.setRawMode !== 'function') throw new Error('Masked secret input is unavailable in this terminal.');
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    const wasRaw = input.isRaw;
    let value = '';
    const finish = (result: string | Error) => {
      input.off('data', onData);
      input.setRawMode?.(wasRaw ?? false);
      output.write('\n');
      result instanceof Error ? reject(result) : resolve(result);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return finish(new Error('cancelled'));
        if (character === '\r' || character === '\n') return finish(value);
        if (character === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        value += character;
        output.write('*');
      }
    };
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url];
  try {
    const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    await child.exited;
  } catch {
    // The authorization URL is already printed, so manual navigation remains available.
  }
}

export async function createLoopbackCallback(): Promise<{
  readonly callbackUrl: string;
  readonly wait: (timeoutMs: number) => Promise<string>;
  readonly close: () => void;
}> {
  let resume: ((url: string) => void) | undefined;
  const received = new Promise<string>((resolve) => { resume = resolve; });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== '/oauth/callback') return new Response('Not found.', { status: 404 });
      resume?.(request.url);
      return new Response('Provider login complete. You may return to Fred.', { status: 200 });
    },
  });
  const callbackUrl = `http://127.0.0.1:${server.port}/oauth/callback`;
  return {
    callbackUrl,
    wait: (timeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Provider login timed out.')), Math.max(1, timeoutMs));
      void received.then((url) => {
        clearTimeout(timer);
        resolve(url);
      });
    }),
    close: () => server.stop(true),
  };
}

/** Execute a provider command through the same Effect workflow used by CLI and TUI adapters. */
export async function handleProviderCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: ProviderCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const openStore = deps.openStore ?? defaultOpenStore;
  let lease: ProviderConnectionCommandStoreLease | undefined;
  try {
    lease = await openStore();
    return await Effect.runPromise(executeProviderCommand(args, options, lease.store, deps, io).pipe(
      Effect.catchTag('ProviderCommandError', (error) => Effect.sync(() => {
        if (options.json === true) {
          io.stdout(JSON.stringify({ ok: false, command: 'provider', error: { code: error.code, message: error.message } }, null, 2));
        } else {
          io.stderr(error.message);
        }
        return error.code === 'usage' ? 2 : error.code === 'cancelled' ? 5 : error.code === 'connectivity' ? 4 : 1;
      })),
    ));
  } catch (error) {
    const message = sanitizeErrorForCli(error);
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'provider', error: { code: 'internal', message } }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  } finally {
    await lease?.close().catch(() => undefined);
  }
}

/** TUI `/login` adapter: it deliberately shares the CLI command service and accepts no secret arguments. */
export const handleProviderLoginSlash = async (args: string): Promise<string> => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await handleProviderCommand(['login', ...tokens], { headless: false }, {
    io: { stdout: (message) => output.push(message), stderr: (message) => errors.push(message) },
  });
  return exitCode === 0 ? output.join('\n') : errors.join('\n') || 'Provider login did not complete.';
};
