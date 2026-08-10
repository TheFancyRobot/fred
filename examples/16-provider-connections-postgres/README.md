# 16 - Provider Connections with PostgreSQL

This runnable example installs Fred's isolated PostgreSQL schema, keeps an
unrelated application sentinel unchanged, then saves and resolves three
explicit connections: a private local OpenAI-compatible endpoint without
credentials, a local API-key connection, and a Google OAuth credential fixture.

## Run it

Use a disposable database. The example never imports from or deletes `public`,
but it writes migrations and connections to `FRED_POSTGRES_SCHEMA`.

```bash
cp .env.example .env
export FRED_POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:5432/fred_example'
bun run start
```

`FRED_PGVECTOR_MODE=auto` works whether `pgvector` is installed. Use
`required` only when the application needs vector support; `install` requires
database-level `CREATE EXTENSION` permission.

The ephemeral encryption key and all fixture credentials are generated in
memory. They are never printed, committed, or reused. Production applications
must obtain key material from a secret manager, retain old keys until rotation
finishes, and back up before any legacy import.

Read the operator contract in
[`docs/guides/provider-connections.md`](../../docs/guides/provider-connections.md)
and [`docs/guides/postgres.md`](../../docs/guides/postgres.md).
