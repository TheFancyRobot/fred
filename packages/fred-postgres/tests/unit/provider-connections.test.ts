import { describe, expect, spyOn, test } from 'bun:test';
import { Cause, Effect, Exit, Layer, Redacted, Schema } from 'effect';
import { Pool } from 'pg';
import {
  ProviderConnectionId,
  ProviderConnectionNamespace,
  ProviderConnectionStore,
  type ProviderConnection,
} from '@fancyrobot/fred';
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  fredPostgresProviderConnectionMigrations,
  makePostgresProviderConnectionStore,
  makePostgresProviderConnectionStoreLayer,
  makeProviderCredentialKeyRing,
  ProviderCredentialKeyRing,
  type ProviderCredentialEnvelope,
  type PostgresPool,
} from '../../src';

const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
const namespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-a');
const connection: ProviderConnection = {
  id: connectionId,
  label: 'Primary',
  providerId: 'openai',
  auth: { kind: 'api-key' },
  status: 'active',
};
const canary = 'provider-credential-canary-never-log';
const credentials = { kind: 'api-key' as const, apiKey: Redacted.make(canary) };
const key = { id: 'key-1', key: Redacted.make(new Uint8Array(32).fill(7)) };

const rotationRow = async (candidate: ProviderConnection, encryptionKey: typeof key) => {
  const encrypted = await Effect.runPromise(encryptProviderCredentials({ namespace, connection: candidate, credentials, key: encryptionKey }));
  return {
    id: candidate.id,
    namespace,
    label: candidate.label,
    provider_id: candidate.providerId,
    endpoint: null,
    protocol: null,
    auth_kind: candidate.auth.kind,
    status: candidate.status,
    credential_version: 1,
    expires_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    envelope_version: encrypted.version,
    algorithm: encrypted.algorithm,
    key_id: encrypted.keyId,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
  };
};

interface QueryStep {
  readonly contains: string;
  readonly excludes?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly rowCount?: number;
  readonly error?: Error;
  readonly assertValues?: (values: unknown[] | undefined) => void;
}

const scriptedPool = (steps: QueryStep[]): PostgresPool => ({
  connect: async () => ({
    query: async (sql, values) => {
      const step = steps.shift();
      if (step === undefined) throw new Error(`Unexpected query: ${sql}`);
      expect(sql).toContain(step.contains);
      if (step.excludes !== undefined) expect(sql).not.toContain(step.excludes);
      step.assertValues?.(values);
      if (step.error !== undefined) throw step.error;
      return { rows: step.rows ?? [], rowCount: step.rowCount ?? step.rows?.length ?? 0 };
    },
    release: () => undefined,
  }),
});

describe('provider credential encryption', () => {
  test('uses AES-GCM with fresh nonces and keeps the plaintext out of the envelope', async () => {
    const [first, second] = await Effect.runPromise(Effect.all([
      encryptProviderCredentials({ namespace, connection, credentials, key }),
      encryptProviderCredentials({ namespace, connection, credentials, key }),
    ]));

    expect(first.algorithm).toBe('AES-256-GCM');
    expect(first.nonce).toHaveLength(12);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(new TextDecoder().decode(first.ciphertext)).not.toContain(canary);
    expect(JSON.stringify(first)).not.toContain(canary);

    const decrypted = await Effect.runPromise(decryptProviderCredentials(namespace, connection, first, key));
    expect(decrypted.kind).toBe('api-key');
    if (decrypted.kind === 'api-key') expect(Redacted.value(decrypted.apiKey)).toBe(canary);
  });

  test('rejects wrong keys, tampering, and invalid key lengths without secret fragments', async () => {
    const encrypted = await Effect.runPromise(encryptProviderCredentials({ namespace, connection, credentials, key }));
    const tampered: ProviderCredentialEnvelope = {
      ...encrypted,
      ciphertext: Uint8Array.from(encrypted.ciphertext, (byte, index) => index === 0 ? byte ^ 1 : byte),
    };
    const wrongKey = { id: 'key-1', key: Redacted.make(new Uint8Array(32).fill(9)) };

    for (const effect of [
      decryptProviderCredentials(namespace, connection, encrypted, wrongKey),
      decryptProviderCredentials(namespace, connection, tampered, key),
      decryptProviderCredentials(Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-b'), connection, encrypted, key),
      encryptProviderCredentials({ namespace, connection, credentials, key: { id: 'bad', key: Redacted.make(new Uint8Array(31)) } }),
    ]) {
      const exit = await Effect.runPromiseExit(effect);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe('Some');
        if (failure._tag === 'Some') expect(JSON.stringify(failure.value)).not.toContain(canary);
      }
    }
  });
});

test('defines explicit schema-qualified metadata and ciphertext migrations', () => {
  const [migration] = fredPostgresProviderConnectionMigrations('fred_connections_test');
  expect(migration.module).toBe('provider-connections');
  expect(migration.sql).toContain('"fred_connections_test"."provider_connections"');
  expect(migration.sql).toContain('"fred_connections_test"."provider_credentials"');
  expect(migration.sql).toContain('UNIQUE (namespace, provider_id, label_normalized)');
  expect(migration.sql).toContain('ON DELETE CASCADE');
  expect(migration.sql).not.toContain('"public".');
  expect(migration.sql).not.toContain('DEFAULT gen_random_uuid');
});

test('credential rotation reports malformed and unavailable rows while continuing with later rows', async () => {
  const missingKey = { id: 'missing', key: Redacted.make(new Uint8Array(32).fill(3)) };
  const oldKey = { id: 'old', key: Redacted.make(new Uint8Array(32).fill(4)) };
  const currentKey = { id: 'current', key: Redacted.make(new Uint8Array(32).fill(5)) };
  const laterConnection = { ...connection, id: Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'), label: 'Later' };
  const [missingRow, laterRow] = await Promise.all([rotationRow(connection, missingKey), rotationRow(laterConnection, oldKey)]);
  const rows = [{ ...missingRow, id: 'not-a-uuid' }, missingRow, laterRow];
  const steps: QueryStep[] = [
    { contains: 'ORDER BY k.updated_at', rows },
    { contains: 'WHERE connection_id = $1 AND key_id = $2', rowCount: 1 },
    { contains: 'BEGIN' },
    { contains: 'UPDATE "fred"."provider_connections"', rowCount: 1 },
    { contains: 'UPDATE "fred"."provider_credentials"', rowCount: 1 },
    { contains: 'COMMIT' },
    { contains: 'SELECT 1 FROM "fred"."provider_connections"', rows: [{ one: 1 }] },
  ];
  const store = makePostgresProviderConnectionStore({
    pool: scriptedPool(steps),
    keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
  });

  const result = await Effect.runPromise(store.rotateCredentials(namespace, 3));

  expect(result.rotated).toBe(1);
  expect(result.remaining).toBe(true);
  expect(result.skipped).toHaveLength(2);
  expect(result.skipped[0]).toMatchObject({ connectionId: 'not-a-uuid', keyId: missingKey.id, error: { _tag: 'ProviderConnectionStorageError' } });
  expect(result.skipped[1]).toMatchObject({ connectionId: connection.id, keyId: missingKey.id, error: { _tag: 'ProviderCredentialKeyError' } });
  expect(JSON.stringify(result)).not.toContain(canary);
  expect(steps).toHaveLength(0);
});

test('credential rotation advances past a skipped oldest row on the next bounded call', async () => {
  const missingKey = { id: 'missing', key: Redacted.make(new Uint8Array(32).fill(3)) };
  const oldKey = { id: 'old', key: Redacted.make(new Uint8Array(32).fill(4)) };
  const currentKey = { id: 'current', key: Redacted.make(new Uint8Array(32).fill(5)) };
  const laterConnection = { ...connection, id: Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'), label: 'Later' };
  const [blockedRow, laterRow] = await Promise.all([rotationRow(connection, missingKey), rotationRow(laterConnection, oldKey)]);
  const steps: QueryStep[] = [
    { contains: 'ORDER BY k.updated_at', rows: [blockedRow] },
    {
      contains: 'WHERE connection_id = $1 AND key_id = $2',
      rowCount: 1,
      assertValues: (values) => expect(values).toEqual([connection.id, missingKey.id]),
    },
    { contains: 'SELECT 1 FROM "fred"."provider_connections"', rows: [{ one: 1 }] },
    { contains: 'ORDER BY k.updated_at', rows: [laterRow] },
    { contains: 'BEGIN' },
    { contains: 'UPDATE "fred"."provider_connections"', rowCount: 1 },
    { contains: 'UPDATE "fred"."provider_credentials"', rowCount: 1 },
    { contains: 'COMMIT' },
    { contains: 'SELECT 1 FROM "fred"."provider_connections"', rows: [{ one: 1 }] },
  ];
  const store = makePostgresProviderConnectionStore({
    pool: scriptedPool(steps),
    keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
  });

  expect(await Effect.runPromise(store.rotateCredentials(namespace, 1))).toMatchObject({
    rotated: 0,
    remaining: true,
    skipped: [{ connectionId: connection.id, keyId: missingKey.id }],
  });
  expect(await Effect.runPromise(store.rotateCredentials(namespace, 1))).toMatchObject({
    rotated: 1,
    remaining: true,
    skipped: [],
  });
  expect(steps).toHaveLength(0);
});

test('credential rotation fails when skipped-row queue progress cannot be persisted', async () => {
  const missingKey = { id: 'missing', key: Redacted.make(new Uint8Array(32).fill(3)) };
  const currentKey = { id: 'current', key: Redacted.make(new Uint8Array(32).fill(5)) };
  const blockedRow = await rotationRow(connection, missingKey);
  const steps: QueryStep[] = [
    { contains: 'ORDER BY k.updated_at', rows: [blockedRow] },
    { contains: 'WHERE connection_id = $1 AND key_id = $2', error: new Error('database unavailable') },
  ];
  const store = makePostgresProviderConnectionStore({
    pool: scriptedPool(steps),
    keyRing: makeProviderCredentialKeyRing([currentKey], currentKey.id),
  });

  const exit = await Effect.runPromiseExit(store.rotateCredentials(namespace, 1));

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe('Some');
    if (failure._tag === 'Some') expect(failure.value).toMatchObject({ _tag: 'ProviderConnectionStorageError' });
  }
  expect(steps).toHaveLength(0);
});

test('credential save and rotation preserve expiry while compare-and-set can clear it', async () => {
  const expiry = new Date('2030-01-01T00:00:00.000Z');
  const oldKey = { id: 'old', key: Redacted.make(new Uint8Array(32).fill(4)) };
  const currentKey = { id: 'current', key: Redacted.make(new Uint8Array(32).fill(5)) };
  const row = { ...(await rotationRow(connection, oldKey)), expires_at: expiry };
  const metadataRow = { ...row, credential_version: 2 };
  const steps: QueryStep[] = [
    { contains: 'BEGIN' },
    { contains: 'SELECT credential_version, expires_at', rows: [{ credential_version: 1, expires_at: expiry }] },
    {
      contains: 'SET provider_id = $2',
      rowCount: 1,
      assertValues: (values) => expect(values?.[9]).toEqual(expiry),
    },
    { contains: 'UPDATE "fred"."provider_credentials"', rowCount: 1 },
    { contains: 'COMMIT' },
    { contains: 'WHERE namespace = $1 AND id = $2', rows: [metadataRow] },
    { contains: 'BEGIN' },
    {
      contains: 'SET credential_version = $2',
      excludes: 'provider_id',
      rowCount: 1,
      assertValues: (values) => expect(values).toEqual([connection.id, 3, null, namespace, 2]),
    },
    { contains: 'UPDATE "fred"."provider_credentials"', rowCount: 1 },
    { contains: 'COMMIT' },
    { contains: 'ORDER BY k.updated_at', rows: [row] },
    { contains: 'BEGIN' },
    {
      contains: 'SET credential_version = $2',
      excludes: 'provider_id',
      rowCount: 1,
      assertValues: (values) => expect(values).toEqual([connection.id, 2, expiry, namespace, 1]),
    },
    { contains: 'UPDATE "fred"."provider_credentials"', rowCount: 1 },
    { contains: 'COMMIT' },
    { contains: 'SELECT 1 FROM "fred"."provider_connections"', rows: [] },
  ];
  const store = makePostgresProviderConnectionStore({
    pool: scriptedPool(steps),
    keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
  });

  await Effect.runPromise(store.save(namespace, connection, credentials));
  expect(await Effect.runPromise(store.compareAndSetCredentials(namespace, connection.id, credentials, 2))).toBe(true);
  expect(await Effect.runPromise(store.rotateCredentials(namespace))).toMatchObject({ rotated: 1, remaining: false });
  expect(steps).toHaveLength(0);
});

test('credential rotation checks remaining rows after an optimistic-version race', async () => {
  const oldKey = { id: 'old', key: Redacted.make(new Uint8Array(32).fill(4)) };
  const currentKey = { id: 'current', key: Redacted.make(new Uint8Array(32).fill(5)) };
  const row = await rotationRow(connection, oldKey);
  const steps: QueryStep[] = [
    { contains: 'ORDER BY k.updated_at', rows: [row] },
    { contains: 'BEGIN' },
    { contains: 'UPDATE "fred"."provider_connections"', rowCount: 0 },
    { contains: 'ROLLBACK' },
    { contains: 'WHERE connection_id = $1 AND key_id = $2', rowCount: 1 },
    { contains: 'SELECT 1 FROM "fred"."provider_connections"', rows: [{ one: 1 }] },
  ];
  const store = makePostgresProviderConnectionStore({
    pool: scriptedPool(steps),
    keyRing: makeProviderCredentialKeyRing([oldKey, currentKey], currentKey.id),
  });

  const result = await Effect.runPromise(store.rotateCredentials(namespace));

  expect(result).toMatchObject({ rotated: 0, remaining: true });
  expect(result.skipped[0]?.error._tag).toBe('ProviderCredentialVersionConflictError');
  expect(steps).toHaveLength(0);
});

test('closes a connectionString store with the pg Pool receiver intact', async () => {
  let receiver: Pool | undefined;
  const end = spyOn(Pool.prototype, 'end').mockImplementation(async function (this: Pool) {
    receiver = this;
  });
  try {
    const store = makePostgresProviderConnectionStore({
      connectionString: 'postgres://fred:fred@127.0.0.1/fred',
      keyRing: makeProviderCredentialKeyRing([key], key.id),
    });
    await Effect.runPromise(store.close);
    expect(receiver).toBeInstanceOf(Pool);
  } finally {
    end.mockRestore();
  }
});

test('scoped store layers close owned pools and leave external pools open', async () => {
  let ownedCloseCount = 0;
  const end = spyOn(Pool.prototype, 'end').mockImplementation(async function (this: Pool) {
    ownedCloseCount += 1;
  });
  const keyRing = Layer.succeed(ProviderCredentialKeyRing, makeProviderCredentialKeyRing([key], key.id));
  const useStore = Effect.scoped(ProviderConnectionStore.pipe(Effect.provide(
    makePostgresProviderConnectionStoreLayer({
      connectionString: 'postgres://fred:fred@127.0.0.1/fred',
    }).pipe(Layer.provide(keyRing)),
  )));
  try {
    await Effect.runPromise(useStore);
    expect(ownedCloseCount).toBe(1);

    let externalClosed = false;
    const external: PostgresPool = {
      connect: async () => { throw new Error('not used'); },
      end: async () => { externalClosed = true; },
    };
    await Effect.runPromise(Effect.scoped(ProviderConnectionStore.pipe(Effect.provide(
      makePostgresProviderConnectionStoreLayer({ pool: external }).pipe(Layer.provide(keyRing)),
    ))));
    expect(externalClosed).toBe(false);
  } finally {
    end.mockRestore();
  }
});
