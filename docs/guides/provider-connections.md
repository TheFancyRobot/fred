# Provider Connections

A provider connection is named, non-secret metadata plus runtime credentials.
Persisted selection is always explicit: set an agent's `connectionId` and
consumer-owned `connectionNamespace`. Every management call also requires that
namespace, so one shared Fred schema can safely serve multiple applications or
workspaces. Omitting `connectionId` only enables the legacy environment adapter;
Fred never chooses the first saved record.

## Capability matrix

| Provider | Saved authentication | Login flow |
| --- | --- | --- |
| OpenAI | API key | Manual secret |
| Anthropic | API key | Manual secret |
| Google | API key or OAuth bearer | Manual secret or installed-app OAuth |
| Groq | API key | Manual secret |
| MiniMax | API key | Manual secret |
| OpenRouter | API key | Manual secret or PKCE API-key login |
| Local-compatible | None, API key, or Basic | Manual secret |

Google OAuth stores access and refresh tokens. OpenRouter's PKCE login returns
a user-controlled API key, not an OAuth access/refresh-token pair. A
local-compatible connection must declare either `openai-compatible` or
`anthropic-compatible` protocol and an explicit `http` or `https` endpoint.
At invocation time, configure the agent's platform as `openai` for an
`openai-compatible` connection or `anthropic` for an `anthropic-compatible`
connection. Fred routes the saved connection through those existing provider
packages; there is no separate local provider package.
Local `openai-compatible` execution uses the OpenAI Chat Completions protocol,
including JSON-schema structured output; hosted OpenAI execution retains its
Responses transport.

## CLI workflow

The CLI uses PostgreSQL only when both the database URL and a 32-byte base64url
credential key are supplied. The key is never printed by Fred.

```bash
export FRED_POSTGRES_URL='postgres://...'
export FRED_PROVIDER_CREDENTIAL_KEY='base64url-encoded-32-byte-key'
export FRED_PROVIDER_CREDENTIAL_KEY_ID='2026-08'
export FRED_PROVIDER_CONNECTION_NAMESPACE='workspace-123'

fred provider add local-compatible private-no-auth \
  --auth none --protocol openai-compatible --endpoint http://127.0.0.1:11434/v1 --test
fred provider add openai primary --auth api-key --secret-stdin
fred provider login google work
fred provider login openrouter personal
fred provider list --json
fred provider status <connection-id> --json
fred provider logout <connection-id>
```

`--test` tests the draft before it is saved. It is not a live-provider CI
substitute. `logout` removes local encrypted credentials; Google additionally
attempts token revocation. If remote revocation fails, fix it before treating
the local deletion as a completed incident response.

## Application integration

The Promise client accepts one explicit `providerConnectionLayer`. This keeps
PostgreSQL optional and lets the same saved connection service serve both
agent execution and `fred.connections` management.

```ts
import {
  LegacyProviderConnectionResolver,
  ProviderConnectionServiceLive,
  ProviderConnectionStore,
  createFred,
  decodeProviderConnectionNamespace,
  makeLegacyProviderConnectionResolver,
} from '@fancyrobot/fred';
import { makePostgresProviderConnectionStore, makeProviderCredentialKeyRing } from '@fancyrobot/fred-postgres';
import { Effect, Layer, Redacted } from 'effect';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.FRED_POSTGRES_URL });
const keyRing = makeProviderCredentialKeyRing([
  { id: '2026-08', key: Redacted.make(new Uint8Array(32)) },
], '2026-08');
const store = makePostgresProviderConnectionStore({ pool, keyRing });
const providerConnectionLayer = ProviderConnectionServiceLive.pipe(
  Layer.provide(Layer.succeed(ProviderConnectionStore, store)),
  Layer.provide(Layer.succeed(LegacyProviderConnectionResolver, makeLegacyProviderConnectionResolver(process.env))),
);
const fred = await createFred({ providerConnectionLayer });
const namespace = await Effect.runPromise(decodeProviderConnectionNamespace('workspace-123'));
const connections = await fred.connections.list(namespace);

await fred.providers.use('google', {
  googleOAuth: { clientId: process.env.FRED_GOOGLE_OAUTH_CLIENT_ID },
});

await fred.connections.testDraft(draft, credentials); // non-mutating, before save
await fred.connections.put(namespace, connection, credentials, expiresAt);
await fred.connections.updateMetadata(namespace, { ...connection, label: 'Primary production' });
await fred.connections.test(namespace, connection.id); // re-reads the saved credentials
```

Use `updateMetadata` to change a saved label, endpoint, protocol, or status
without decrypting or rotating its credentials. It returns `false` when the ID
does not exist in that namespace. Provider identity and authentication kind are
credential-bound; change those only with `put` and matching replacement
credentials.

Register Google with its installed-app client ID before resolving, testing, or
invoking a saved OAuth connection. Fred checks the saved expiry immediately
before each use, refreshes through Google's token endpoint when needed, and
atomically stores the rotated access token, optional rotated refresh token, and
new expiry. Concurrent processes use credential-version CAS; a loser reloads
the winner. An expired OAuth connection without a registered Google provider or
client ID fails with a sanitized configuration error instead of using the stale
token. Google API-key connections do not require this configuration.

Use key material from a secret manager, not `new Uint8Array(32)`; the value
above only shows the public layer shape. Before using the store, run the
explicit PostgreSQL migrations described in the operations guide.

Legacy variables remain supported for existing applications:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
`GROQ_API_KEY`, `MINIMAX_API_KEY`, and `OPENROUTER_API_KEY`. They are read only
when no `connectionId` is supplied. For an agent using a saved connection,
configure both `connectionId` and `connectionNamespace`.

Connection tests use each provider's authenticated, read-only probe with a
10-second timeout. OpenAI, Anthropic, Google, Groq, and MiniMax list models;
OpenRouter checks the authenticated key endpoint. Local-compatible probes use
the selected OpenAI- or Anthropic-compatible connector. Only successful HTTP
responses pass; typed failures contain a reason and optional status code, but
never response bodies, request URLs, or credentials.
