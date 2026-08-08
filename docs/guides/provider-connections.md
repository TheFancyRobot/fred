# Provider Connections

A provider connection is named, non-secret metadata plus runtime credentials.
Persisted selection is always explicit: set an agent's `connectionId` to a
saved UUID. Omitting it only enables the legacy environment adapter; Fred never
chooses the first saved record.

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
`anthropic-compatible` protocol.

## CLI workflow

The CLI uses PostgreSQL only when both the database URL and a 32-byte base64url
credential key are supplied. The key is never printed by Fred.

```bash
export FRED_POSTGRES_URL='postgres://...'
export FRED_PROVIDER_CREDENTIAL_KEY='base64url-encoded-32-byte-key'
export FRED_PROVIDER_CREDENTIAL_KEY_ID='2026-08'

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
  makeLegacyProviderConnectionResolver,
} from '@fancyrobot/fred';
import { makePostgresProviderConnectionStore, makeProviderCredentialKeyRing } from '@fancyrobot/fred-postgres';
import { Layer, Redacted } from 'effect';
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
```

Use key material from a secret manager, not `new Uint8Array(32)`; the value
above only shows the public layer shape. Before using the store, run the
explicit PostgreSQL migrations described in the operations guide.

Legacy variables remain supported for existing applications:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
`GROQ_API_KEY`, `MINIMAX_API_KEY`, and `OPENROUTER_API_KEY`. They are read only
when no `connectionId` is supplied.
