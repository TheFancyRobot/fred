import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Cause, Effect, Exit, Option, Redacted, Schema } from 'effect';
import { Pool } from 'pg';
import {
  ProviderConnectionId,
  ProviderConnectionIdentityChangeError,
  ProviderConnectionNamespace,
  type ProviderConnection,
} from '@fancyrobot/fred';
import {
  makeFredPostgres,
  makePostgresProviderConnectionStore,
  makeProviderCredentialKeyRing,
  migrateFredPostgresProviderConnections,
} from '../../src';

const connectionString = process.env.FRED_TEST_POSTGRES_URL;
const integration = connectionString === undefined ? test.skip : test;
const schema = () => `fred_test_${randomUUID().replaceAll('-', '')}`;

const key = (id: string, byte: number) => ({ id, key: Redacted.make(new Uint8Array(32).fill(byte)) });
const namespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-a');
const otherNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-b');
const connection = (label: string): ProviderConnection => ({
  id: Schema.decodeUnknownSync(ProviderConnectionId)(randomUUID()),
  label,
  providerId: 'openai',
  auth: { kind: 'api-key' },
  status: 'active',
});

integration('persists encrypted provider credentials with optimistic rotation and transactional deletion', async () => {
  const databaseSchema = schema();
  const pool = new Pool({ connectionString });
  try {
  const database = await Effect.runPromise(makeFredPostgres({ pool, schema: databaseSchema }));
  await Effect.runPromise(migrateFredPostgresProviderConnections(database));

  const oldKey = key('old', 1);
  const store = makePostgresProviderConnectionStore({
    pool,
    schema: (await Effect.runPromise(database.diagnostics)).schema,
    keyRing: makeProviderCredentialKeyRing([oldKey], oldKey.id),
  });
  const first = connection('Primary');
  const second = connection('Backup');
  const canary = 'provider-credential-integration-canary';

  await Effect.runPromise(store.put(namespace, { connection: first, credentials: { kind: 'api-key', apiKey: Redacted.make(canary) } }));
  await Effect.runPromise(store.put(namespace, { connection: second, credentials: { kind: 'api-key', apiKey: Redacted.make('backup-secret') } }));
  const other = connection('Primary');
  await Effect.runPromise(store.put(otherNamespace, { connection: other, credentials: { kind: 'api-key', apiKey: Redacted.make('other-secret') } }));
  expect((await Effect.runPromise(store.list(namespace))).map(({ label }) => label)).toEqual(['Backup', 'Primary']);
  expect((await Effect.runPromise(store.list(otherNamespace))).map(({ label }) => label)).toEqual(['Primary']);
  expect(Option.isNone(await Effect.runPromise(store.get(otherNamespace, first.id)))).toBe(true);
  expect(await Effect.runPromise(store.remove(otherNamespace, first.id))).toBe(false);

  const saved = await Effect.runPromise(store.get(namespace, first.id));
  expect(Option.isSome(saved)).toBe(true);
  if (Option.isSome(saved) && saved.value.credentials.kind === 'api-key') {
    expect(Redacted.value(saved.value.credentials.apiKey)).toBe(canary);
  }

  const raw = await pool.query('SELECT encode(ciphertext, \'base64\') AS ciphertext FROM ' +
    `"${(await Effect.runPromise(database.diagnostics)).schema}"."provider_credentials"`);
  expect(JSON.stringify(raw.rows)).not.toContain(canary);

  const credentialState = () => pool.query(
    `SELECT encode(k.ciphertext, 'hex') AS ciphertext, k.credential_version, c.credential_version AS metadata_version
     FROM "${databaseSchema}"."provider_credentials" k
     JOIN "${databaseSchema}"."provider_connections" c ON c.id = k.connection_id
     WHERE c.id = $1`,
    [first.id],
  );
  const beforeMetadataUpdate = (await credentialState()).rows[0];
  const staleMetadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
  expect(Option.isSome(staleMetadata)).toBe(true);
  const renamed = {
    ...first,
    label: 'Renamed',
    endpoint: 'https://example.test/v1',
    status: 'disabled' as const,
  };
  expect(await Effect.runPromise(store.updateMetadata(namespace, renamed))).toBe(true);
  expect(await Effect.runPromise(store.updateMetadata(otherNamespace, { ...renamed, label: 'Wrong workspace' }))).toBe(false);
  expect((await credentialState()).rows[0]).toEqual(beforeMetadataUpdate);
  const renamedMetadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
  expect(Option.isSome(renamedMetadata)).toBe(true);
  if (Option.isSome(renamedMetadata)) {
    expect(renamedMetadata.value.connection.label).toBe('Renamed');
    expect(renamedMetadata.value.connection.endpoint).toBe('https://example.test/v1');
    expect(renamedMetadata.value.connection.status).toBe('disabled');
  }
  if (Option.isSome(staleMetadata)) {
    expect(await Effect.runPromise(store.compareAndSetCredentials(
      namespace, first.id,
      { kind: 'api-key', apiKey: Redacted.make('concurrent-secret') },
      staleMetadata.value.credentialVersion,
    ))).toBe(true);
    const concurrentMetadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
    expect(Option.isSome(concurrentMetadata)).toBe(true);
    if (Option.isSome(concurrentMetadata)) {
      expect(concurrentMetadata.value.connection.label).toBe('Renamed');
      expect(concurrentMetadata.value.connection.endpoint).toBe('https://example.test/v1');
      expect(concurrentMetadata.value.connection.status).toBe('disabled');
    }
  }
  for (const changed of [
    { ...renamed, providerId: 'anthropic' },
    { ...renamed, auth: { kind: 'none' as const } },
  ]) {
    const exit = await Effect.runPromiseExit(store.updateMetadata(namespace, changed));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) expect(failure.value).toBeInstanceOf(ProviderConnectionIdentityChangeError);
    }
  }

  const metadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
  expect(Option.isSome(metadata)).toBe(true);
  if (Option.isSome(metadata)) {
    const refreshedExpiry = new Date('2030-01-01T00:00:00.000Z');
    expect(await Effect.runPromise(store.compareAndSetCredentials(
      namespace, first.id,
      { kind: 'api-key', apiKey: Redacted.make('rotated-secret') },
      metadata.value.credentialVersion,
      refreshedExpiry,
    ))).toBe(true);
    const refreshedMetadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
    expect(Option.isSome(refreshedMetadata)).toBe(true);
    if (Option.isSome(refreshedMetadata)) {
      expect(refreshedMetadata.value.expiresAt?.toISOString()).toBe(refreshedExpiry.toISOString());
      expect(await Effect.runPromise(store.compareAndSetCredentials(
        namespace, first.id,
        { kind: 'api-key', apiKey: Redacted.make('non-expiring-secret') },
        refreshedMetadata.value.credentialVersion,
      ))).toBe(true);
      const nonExpiringMetadata = await Effect.runPromise(store.getMetadata(namespace, first.id));
      expect(Option.isSome(nonExpiringMetadata)).toBe(true);
      if (Option.isSome(nonExpiringMetadata)) expect(nonExpiringMetadata.value.expiresAt).toBeUndefined();
    }
    expect(await Effect.runPromise(store.compareAndSetCredentials(
      namespace, first.id,
      { kind: 'api-key', apiKey: Redacted.make('stale-secret') },
      metadata.value.credentialVersion,
    ))).toBe(false);
  }

  const currentKey = key('current', 2);
  const rotating = makePostgresProviderConnectionStore({
    pool,
    schema: (await Effect.runPromise(database.diagnostics)).schema,
    keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
  });
  expect((await Effect.runPromise(rotating.rotateCredentials(namespace))).rotated).toBe(2);
  expect(await Effect.runPromise(rotating.remove(namespace, first.id))).toBe(true);
  expect(Option.isNone(await Effect.runPromise(rotating.get(namespace, first.id)))).toBe(true);
  expect((await Effect.runPromise(rotating.list(otherNamespace))).map(({ id }) => id)).toEqual([other.id]);
  } finally {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

integration('isolates skipped credential rows and completes after the historic key is restored', async () => {
  const databaseSchema = schema();
  const pool = new Pool({ connectionString });
  try {
    const database = await Effect.runPromise(makeFredPostgres({ pool, schema: databaseSchema }));
    await Effect.runPromise(migrateFredPostgresProviderConnections(database));
    const missingKey = key('missing', 3);
    const oldKey = key('old', 4);
    const currentKey = key('current', 5);
    const blocked = connection('Blocked');
    const candidate = connection('Candidate');

    await Effect.runPromise(makePostgresProviderConnectionStore({
      pool,
      schema: databaseSchema,
      keyRing: makeProviderCredentialKeyRing([missingKey], missingKey.id),
    }).put(namespace, { connection: blocked, credentials: { kind: 'api-key', apiKey: Redacted.make('blocked-secret') } }));
    await Effect.runPromise(makePostgresProviderConnectionStore({
      pool,
      schema: databaseSchema,
      keyRing: makeProviderCredentialKeyRing([oldKey], oldKey.id),
    }).put(namespace, { connection: candidate, credentials: { kind: 'api-key', apiKey: Redacted.make('candidate-secret') } }));
    await pool.query(
      `UPDATE "${databaseSchema}"."provider_credentials"
       SET updated_at = CASE connection_id WHEN $1 THEN $3::timestamptz ELSE $4::timestamptz END
       WHERE connection_id IN ($1, $2)`,
      [blocked.id, candidate.id, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
    );

    const rotating = makePostgresProviderConnectionStore({
      pool,
      schema: databaseSchema,
      keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
    });
    const partial = await Effect.runPromise(rotating.rotateCredentials(namespace, 1));
    expect(partial.rotated).toBe(0);
    expect(partial.remaining).toBe(true);
    expect(partial.skipped).toHaveLength(1);
    expect(partial.skipped[0]).toMatchObject({
      connectionId: blocked.id,
      keyId: missingKey.id,
      error: { _tag: 'ProviderCredentialKeyError' },
    });
    expect(await Effect.runPromise(rotating.rotateCredentials(namespace, 1))).toMatchObject({
      rotated: 1,
      skipped: [],
      remaining: true,
    });

    const recovered = makePostgresProviderConnectionStore({
      pool,
      schema: databaseSchema,
      keyRing: makeProviderCredentialKeyRing([missingKey, currentKey], currentKey.id),
    });
    expect(await Effect.runPromise(recovered.rotateCredentials(namespace))).toMatchObject({
      rotated: 1,
      skipped: [],
      remaining: false,
    });
  } finally {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
