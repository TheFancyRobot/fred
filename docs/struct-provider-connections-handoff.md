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
  ProviderConnectionNamespace,
  ProviderConnectionSchema,
  ProviderConnectionCredentialsSchema,
  ProviderConnectionServiceLive,
  ProviderConnectionStore,
  decodeProviderConnectionId,
  decodeProviderConnectionNamespace,
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

## Canonical provider identity

Persist a provider factory's stable `id` in `ProviderConnection.providerId` and
pass that same value to `fred.connections.resolve`. The npm package name is only
an install/load coordinate; never persist it as a provider ID. For Fred's
first-party providers, the mapping is:

| Provider ID | Package |
| --- | --- |
| `openai` | `@fancyrobot/fred-openai` |
| `anthropic` | `@fancyrobot/fred-anthropic` |
| `google` | `@fancyrobot/fred-google` |
| `groq` | `@fancyrobot/fred-groq` |
| `minimax` | `@fancyrobot/fred-minimax` |
| `openrouter` | `@fancyrobot/fred-openrouter` |

When loading a custom provider by package name, use the `ProviderDefinition.id`
returned by `ProviderRegistryService.register(...)`; do not derive an ID from
the package specifier.

## Required call sequence

1. Create a pool, key ring, Fred Postgres runtime, and run the explicit
   provider-connection migration.
2. Build `makePostgresProviderConnectionStore`, place it under
   `ProviderConnectionServiceLive`, and pass that layer to
   `createFred({ providerConnectionLayer })`. Import each provider package and
   register it with `fred.providers.use`; for Google OAuth pass
   `{ googleOAuth: { clientId } }` from Struct's secret-backed application
   configuration.
3. Decode Struct's authenticated workspace ID as a
   `ProviderConnectionNamespace`, then call `fred.connections.list(namespace)`
   for a metadata-only list. Never use one shared constant for all workspaces.
4. Construct an unsaved draft and call
   `fred.connections.testDraft(draft, credentials)`; only after it succeeds call
   `fred.connections.put(namespace, connection, credentials, expiresAt)` to
   create or replace credentials. Supply the Google token expiry returned by
   its login flow.
5. Call `fred.connections.updateMetadata(namespace, connection)` to change a
   saved label, endpoint, protocol, or status without reading or rotating its
   credentials. A missing or cross-namespace ID returns `false`; provider ID or
   authentication-kind changes require `put` with matching replacement
   credentials.
6. Call `fred.connections.test(namespace, id)` to retest a saved connection by
   UUID without reading or returning its credentials.
7. Persist the chosen UUID and its namespace on the Struct agent and call
   `fred.connections.resolve({ providerId, namespace, connectionId })` at invocation
   time. Resolution re-reads storage, so credential rotation is visible to the
   next invocation. For Google OAuth it also refreshes an expired token,
   persists the rotated credential with CAS, and returns the winning refreshed
   credential. Agent execution and saved connection tests use this same path.
8. Use CLI-compatible metadata shapes for status: `id`, `label`, `provider`,
   `endpointHost`, `auth`, `status`, and nullable `expiresAt`—never a secret.
9. Call `fred.connections.remove(namespace, id)` only after provider-side revocation when
   appropriate. Revoke Google OAuth remotely; OpenRouter login yields an API
   key and needs provider-console revocation.

Unsupported flows are deliberate: omission cannot select a saved connection;
there is no automatic migration from `public`, no destructive cleanup, no down
migration, no live-provider CI contract, and no database-independent OAuth
token store.

Map the typed errors to sanitized user messages: invalid UUID, not found,
provider mismatch, disabled/deleted connection, unsupported auth/login,
connection test configuration/connectivity/authentication/timeout/upstream failure,
invalid namespace, credential-bound identity change, storage failure, missing
key, envelope authentication failure, missing OAuth provider/client
registration, and optimistic rotation conflict. Do not
forward exception details from PostgreSQL or OAuth servers.
