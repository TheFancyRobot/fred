# PostgreSQL Operations

`@fancyrobot/fred-postgres` is the canonical package for new PostgreSQL adapters
and migrations. The v2 adapters exported by core remain supported for existing
applications and emit a deprecation warning; removal is deferred to the next
major release. The explicit package never adopts `public` tables.

## Install and migrate

```ts
import { Effect } from 'effect';
import { Pool } from 'pg';
import {
  makeFredPostgres,
  migrateFredPostgresProviderConnections,
  migrateFredPostgresStores,
} from '@fancyrobot/fred-postgres';

const pool = new Pool({ connectionString: process.env.FRED_POSTGRES_URL });
const database = await Effect.runPromise(makeFredPostgres({
  pool,
  schema: 'fred',
  vector: 'auto',
}));
await Effect.runPromise(migrateFredPostgresStores(database));
await Effect.runPromise(migrateFredPostgresProviderConnections(database));
```

Use a dedicated schema and least-privilege role with schema usage, table DDL
and DML in that schema, plus advisory-lock access. `vector: 'install'` also
requires database-level `CREATE EXTENSION`; do not grant it just for `auto`.

| pgvector mode | Behaviour |
| --- | --- |
| `auto` | Detects the extension and continues when absent. Default. |
| `install` | Creates the extension when permitted, otherwise fails. |
| `off` | Never checks or creates the extension. |
| `required` | Fails when the extension is absent. |

Migrations take a per-schema advisory lock (30 seconds by default) and leave
application schemas, grants, rows, extensions, and search path untouched.
Record observed migration duration and lock time in the release rehearsal;
Fred does not promise a universal migration SLA.

## Legacy adoption and recovery

Existing core adapters and `fred-http` stores preserve their v2 behavior when
constructed without an explicit schema. Pass `schema` to opt into the
schema-qualified adapters and migrations from `@fancyrobot/fred-postgres`.

1. Back up the database and rehearse restore in disposable infrastructure.
2. Run the explicit Fred migrations in the destination schema.
3. Run `importLegacyFredPostgresStores` only for selected legacy modules.
4. Verify its source and destination counts/checksums; source rows remain.
5. Keep the backup until production verification is complete.

The importer is copy-only and idempotent. It refuses ambiguous source columns
and non-empty destinations. There are no down migrations and no automatic
`public` adoption. To recover an incompatible database/package rollback,
restore the tested backup or roll forward with a compatible release; do not
delete Fred tables as a rollback shortcut.

Credential backups contain encrypted envelopes and still require the same
access controls as secrets. Retain the current and prior key-ring entries until
every envelope is re-encrypted. If an older key is missing, restore it from the
secret manager, rotate in batches, then remove it only after verification.
