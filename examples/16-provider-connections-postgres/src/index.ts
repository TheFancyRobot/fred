import { randomUUID } from 'node:crypto';
import {
  LegacyProviderConnectionResolver,
  ProviderConnectionServiceLive,
  ProviderConnectionStore,
  createFred,
  decodeProviderConnectionId,
  decodeProviderConnectionNamespace,
  makeLegacyProviderConnectionResolver,
  type ProviderConnection,
  type ProviderConnectionCredentials,
} from '@fancyrobot/fred';
import {
  makeFredPostgres,
  makePostgresProviderConnectionStore,
  makeProviderCredentialKeyRing,
  migrateFredPostgresProviderConnections,
  migrateFredPostgresStores,
  quotePostgresIdentifier,
  type PgvectorMode,
} from '@fancyrobot/fred-postgres';
import { Effect, Layer, Redacted } from 'effect';
import { Pool } from 'pg';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const vectorMode = (value: string | undefined): PgvectorMode => {
  if (value === undefined || value === 'auto') return 'auto';
  if (value === 'install' || value === 'off' || value === 'required') return value;
  throw new Error('FRED_PGVECTOR_MODE must be auto, install, off, or required.');
};

const connection = async (
  label: string,
  providerId: string,
  auth: ProviderConnection['auth'],
  credentials: ProviderConnectionCredentials,
  endpoint?: string,
): Promise<{ readonly connection: ProviderConnection; readonly credentials: ProviderConnectionCredentials }> => ({
  connection: {
    id: await Effect.runPromise(decodeProviderConnectionId(randomUUID())),
    label,
    providerId,
    auth,
    status: 'active',
    ...(endpoint === undefined ? {} : { endpoint, protocol: 'openai-compatible' as const }),
  },
  credentials,
});

async function main(): Promise<void> {
  const connectionString = process.env.FRED_POSTGRES_URL;
  if (!connectionString) throw new Error('Set FRED_POSTGRES_URL to a disposable PostgreSQL database.');

  const schema = process.env.FRED_POSTGRES_SCHEMA ?? 'fred_example';
  const namespace = await Effect.runPromise(decodeProviderConnectionNamespace(
    process.env.FRED_PROVIDER_CONNECTION_NAMESPACE ?? 'example-workspace',
  ));
  const runId = randomUUID().replaceAll('-', '');
  const sentinelSchema = `application_sentinel_${runId}`;
  const sentinel = `${quotePostgresIdentifier(sentinelSchema)}.${quotePostgresIdentifier('events')}`;
  const pool = new Pool({ connectionString });
  const key = { id: 'example-ephemeral', key: Redacted.make(crypto.getRandomValues(new Uint8Array(32))) };
  const keyRing = makeProviderCredentialKeyRing([key], key.id);
  const store = makePostgresProviderConnectionStore({ pool, schema, keyRing });
  const providerConnectionLayer = ProviderConnectionServiceLive.pipe(
    Layer.provide(Layer.succeed(ProviderConnectionStore, store)),
    Layer.provide(Layer.succeed(LegacyProviderConnectionResolver, makeLegacyProviderConnectionResolver({}))),
  );
  const fred = await createFred({ providerConnectionLayer });
  let server: ReturnType<typeof Bun.serve> | undefined;

  try {
    await pool.query(`CREATE SCHEMA ${quotePostgresIdentifier(sentinelSchema)}`);
    await pool.query(`CREATE TABLE ${sentinel} (name TEXT NOT NULL)`);
    await pool.query(`INSERT INTO ${sentinel} (name) VALUES ('unchanged application sentinel')`);

    const database = await Effect.runPromise(makeFredPostgres({
      pool,
      schema,
      vector: vectorMode(process.env.FRED_PGVECTOR_MODE),
    }));
    await Effect.runPromise(migrateFredPostgresStores(database));
    await Effect.runPromise(migrateFredPostgresProviderConnections(database));

    let privateRequestSentCredentials = false;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        privateRequestSentCredentials ||= request.headers.has('authorization');
        return new Response(null, { status: request.method === 'HEAD' ? 204 : 405 });
      },
    });
    const privateEndpoint = `${server.url}v1/models`;
    const health = await fetch(privateEndpoint, { method: 'HEAD' });
    assert(health.status === 204, `private no-auth endpoint returned ${health.status}`);
    assert(!privateRequestSentCredentials, 'no-auth endpoint received credentials');

    const localNoAuth = await connection(
      `private-no-auth-${runId}`,
      'local-compatible',
      { kind: 'none' },
      { kind: 'none' },
      server.url.toString(),
    );
    const localApiKey = await connection(
      `private-api-key-${runId}`,
      'local-compatible',
      { kind: 'api-key' },
      { kind: 'api-key', apiKey: Redacted.make(`example-${randomUUID()}`) },
      server.url.toString(),
    );
    const googleFixture = await connection(
      `google-oauth-fixture-${runId}`,
      'google',
      { kind: 'oauth2-bearer' },
      {
        kind: 'oauth2-bearer',
        accessToken: Redacted.make(`fixture-${randomUUID()}`),
        refreshToken: Redacted.make(`fixture-${randomUUID()}`),
      },
    );

    await fred.connections.put(namespace, localNoAuth.connection, localNoAuth.credentials);
    await fred.connections.put(namespace, localApiKey.connection, localApiKey.credentials);
    await fred.connections.put(namespace, googleFixture.connection, googleFixture.credentials);

    const saved = await fred.connections.list(namespace);
    assert(saved.some(({ id }) => id === localNoAuth.connection.id), 'no-auth connection was not saved');
    assert(saved.some(({ id }) => id === localApiKey.connection.id), 'API-key connection was not saved');
    assert(saved.some(({ id }) => id === googleFixture.connection.id), 'OAuth fixture was not saved');
    const resolved = await fred.connections.resolve({
      providerId: 'local-compatible',
      namespace,
      connectionId: localNoAuth.connection.id,
    });
    assert(resolved.source === 'saved' && resolved.credentials.kind === 'none', 'explicit local connection did not resolve');

    const sentinelRow = await pool.query<{ readonly name: string }>(`SELECT name FROM ${sentinel}`);
    assert(sentinelRow.rows[0]?.name === 'unchanged application sentinel', 'Fred changed an application sentinel');
    console.log(`Saved ${saved.length} non-secret connection records in schema ${schema}.`);
    console.log('Verified a private no-auth local endpoint, API-key storage, and Google OAuth fixture storage.');
  } finally {
    server?.stop(true);
    await fred.shutdown();
    await pool.query(`DROP SCHEMA IF EXISTS ${quotePostgresIdentifier(sentinelSchema)} CASCADE`).catch(() => undefined);
    await Effect.runPromise(store.close).catch(() => undefined);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Provider connection example failed.');
  process.exitCode = 1;
});
