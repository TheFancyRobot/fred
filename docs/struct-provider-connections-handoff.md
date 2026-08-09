# Struct provider-connection handoff

Struct consumes Fred's provider-connection contract; it does not implement a
second credential store. This handoff targets the additive Phase 70 v2.x release
cohort. Existing v2 imports remain supported; use the new package for
PostgreSQL migrations and provider-connection storage. Confirm final tagged
versions from generated release manifests before pinning them.

## Public imports

```ts
import {
  ProviderConnectionId,
  ProviderConnectionSchema,
  ProviderConnectionCredentialsSchema,
  ProviderConnectionServiceLive,
  ProviderConnectionStore,
  decodeProviderConnectionId,
  createFred,
} from '@fancyrobot/fred';
import {
  makeFredPostgres,
  migrateFredPostgresProviderConnections,
  makePostgresProviderConnectionStore,
  makeProviderCredentialKeyRing,
  ProviderCredentialKeyError,
  ProviderCredentialEncryptionError,
  ProviderCredentialVersionConflictError,
  ProviderConnectionStorageError,
} from '@fancyrobot/fred-postgres';
```

Use `ProviderConnectionSchema` and `ProviderConnectionCredentialsSchema` for
boundary validation. Credentials are runtime-only redacted values; Struct must
never accept them in list/status responses or persist them outside the Fred
store.

## Required call sequence

1. Create a pool, key ring, Fred Postgres runtime, and run the explicit
   provider-connection migration.
2. Build `makePostgresProviderConnectionStore`, place it under
   `ProviderConnectionServiceLive`, and pass that layer to
   `createFred({ providerConnectionLayer })`.
3. Call `fred.connections.list()` for metadata-only list.
4. Construct and capability-test an unsaved draft; then call
   `fred.connections.put(connection, credentials)` to create or update.
5. Persist the chosen UUID on the Struct agent and call
   `fred.connections.resolve({ providerId, connectionId })` at invocation
   time. Resolution re-reads storage, so credential rotation is visible to the
   next invocation.
6. Use CLI-compatible metadata shapes for status: `id`, `label`, `provider`,
   `endpointHost`, `auth`, `status`, and nullable `expiresAt`—never a secret.
7. Call `fred.connections.remove(id)` only after provider-side revocation when
   appropriate. Revoke Google OAuth remotely; OpenRouter login yields an API
   key and needs provider-console revocation.

Unsupported flows are deliberate: omission cannot select a saved connection;
there is no automatic migration from `public`, no destructive cleanup, no down
migration, no live-provider CI contract, and no database-independent OAuth
token store.

Map the typed errors to sanitized user messages: invalid UUID, not found,
provider mismatch, disabled/deleted connection, unsupported auth/login,
storage failure, missing key, envelope authentication failure, and optimistic
rotation conflict. Do not forward exception details from PostgreSQL or OAuth
servers.
