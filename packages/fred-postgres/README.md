# @fancyrobot/fred-postgres

Explicit PostgreSQL migrations and pgvector capability detection for Fred.

Creating a runtime performs no database mutations. Run the explicit store migration before creating an adapter:

```ts
import { Effect } from 'effect';
import { Pool } from 'pg';
import {
  makeFredPostgres,
  migrateFredPostgresStores,
  PostgresCheckpointStorage,
  PostgresContextStorage,
} from '@fancyrobot/fred-postgres';

const pool = new Pool({ connectionString: process.env.FRED_POSTGRES_URL });
const database = await Effect.runPromise(makeFredPostgres({ pool, schema: 'fred' }));
await Effect.runPromise(migrateFredPostgresStores(database));

const context = new PostgresContextStorage({ pool, schema: 'fred' });
const checkpoints = new PostgresCheckpointStorage({ pool, schema: 'fred' });
```

The adapters never execute DDL and never query `public`. Existing `public`
tables require a backup and an explicit, copy-only import:

```ts
import { importLegacyFredPostgresStores } from '@fancyrobot/fred-postgres';

await Effect.runPromise(importLegacyFredPostgresStores({
  pool,
  schema: 'fred',
  modules: ['context'],
  dryRun: true,
}));
```

The importer rejects ambiguous columns and non-empty destinations, verifies row
counts and checksums, records idempotency, and leaves every source table intact.
Omit `dryRun` only after reviewing the returned `pending` tables. The Fred CLI
wraps the same operation as `fred postgres import-legacy`; it reads the database
URL from `FRED_POSTGRES_URL`, supports `--dry-run`, and requires confirmation or
`--yes` before copying.

## Provider connections

Run `migrateFredPostgresProviderConnections(database)` explicitly, then create
`makePostgresProviderConnectionStore()` with an application-owned AES-256 key
ring. Compose that store under Fred's `ProviderConnectionServiceLive` and pass
the resulting `providerConnectionLayer` to `createFred()`. Supply a non-empty,
consumer-owned namespace to every connection operation; the same schema can
then isolate multiple applications or workspaces. Metadata can be
listed safely; runtime credentials remain encrypted and redacted. See the
published provider-connection and PostgreSQL operations guides for key rotation,
legacy-import, backup, and recovery procedures.
