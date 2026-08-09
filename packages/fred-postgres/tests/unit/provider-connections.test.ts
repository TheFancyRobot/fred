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
