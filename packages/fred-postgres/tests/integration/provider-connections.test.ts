import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Effect, Option, Redacted, Schema } from 'effect';
import { Pool } from 'pg';
import { ProviderConnectionId, type ProviderConnection } from '@fancyrobot/fred';
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
const connection = (label: string): ProviderConnection => ({
  id: Schema.decodeUnknownSync(ProviderConnectionId)(randomUUID()),
  label,
  providerId: 'openai',
  auth: { kind: 'api-key' },
  status: 'active',
});

integration('persists encrypted provider credentials with optimistic rotation and transactional deletion', async () => {
  const pool = new Pool({ connectionString });
  const database = await Effect.runPromise(makeFredPostgres({ pool, schema: schema() }));
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

  await Effect.runPromise(store.put({ connection: first, credentials: { kind: 'api-key', apiKey: Redacted.make(canary) } }));
  await Effect.runPromise(store.put({ connection: second, credentials: { kind: 'api-key', apiKey: Redacted.make('backup-secret') } }));
  expect((await Effect.runPromise(store.list())).map(({ label }) => label)).toEqual(['Backup', 'Primary']);

  const saved = await Effect.runPromise(store.get(first.id));
  expect(Option.isSome(saved)).toBe(true);
  if (Option.isSome(saved) && saved.value.credentials.kind === 'api-key') {
    expect(Redacted.value(saved.value.credentials.apiKey)).toBe(canary);
  }

  const raw = await pool.query('SELECT encode(ciphertext, \'base64\') AS ciphertext FROM ' +
    `"${(await Effect.runPromise(database.diagnostics)).schema}"."provider_credentials"`);
  expect(JSON.stringify(raw.rows)).not.toContain(canary);

  const metadata = await Effect.runPromise(store.getMetadata(first.id));
  expect(Option.isSome(metadata)).toBe(true);
  if (Option.isSome(metadata)) {
    expect(await Effect.runPromise(store.compareAndSetCredentials(
      first.id,
      { kind: 'api-key', apiKey: Redacted.make('rotated-secret') },
      metadata.value.credentialVersion,
    ))).toBe(true);
    expect(await Effect.runPromise(store.compareAndSetCredentials(
      first.id,
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
  expect((await Effect.runPromise(rotating.rotateCredentials())).rotated).toBe(2);
  expect(await Effect.runPromise(rotating.remove(first.id))).toBe(true);
  expect(Option.isNone(await Effect.runPromise(rotating.get(first.id)))).toBe(true);

  await Effect.runPromise(database.close);
});
