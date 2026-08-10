# @fancyrobot/fred-postgres

## 1.0.0

### Major Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`4c8487c`](https://github.com/TheFancyRobot/fred/commit/4c8487cbb7e754c542c5ef4b2b1e657e914e6ac6) Thanks [@sincspecv](https://github.com/sincspecv)! - Add explicit PostgreSQL migrations and pgvector lifecycle support.

### Minor Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`5b0185c`](https://github.com/TheFancyRobot/fred/commit/5b0185c5c0cc276c54ac442ebc8624083c9a663c) Thanks [@sincspecv](https://github.com/sincspecv)! - Add `@fancyrobot/fred-postgres` as the canonical PostgreSQL adapter and migration
  package. Existing core adapters and `fred-http` PostgreSQL stores remain
  functional for this v2 release, but emit a deprecation warning (or use the
  explicit `schema` option for the new schema-qualified path). Migrate after a
  backup and rehearsal; removal is deferred to the next major release.

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`ea43204`](https://github.com/TheFancyRobot/fred/commit/ea4320442214534a8a9768fb65096a1010b096ef) Thanks [@sincspecv](https://github.com/sincspecv)! - Add encrypted PostgreSQL provider-connection storage, typed persistence failures,
  and credential-preserving metadata updates.

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`784cc24`](https://github.com/TheFancyRobot/fred/commit/784cc24848cfdd617075ecb93935c32103878e74) Thanks [@sincspecv](https://github.com/sincspecv)! - Refresh expired Google OAuth credentials immediately before provider use, persist rotated tokens with optimistic credential-version CAS, and expose expiry-aware saved connection writes to Promise consumers.

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`784cc24`](https://github.com/TheFancyRobot/fred/commit/784cc24848cfdd617075ecb93935c32103878e74) Thanks [@sincspecv](https://github.com/sincspecv)! - Add a preflightable `fred postgres import-legacy` command that wraps the existing
  copy-only importer, requires confirmation before writes, and reports verification
  metadata without exposing database credentials.

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`5636cf7`](https://github.com/TheFancyRobot/fred/commit/5636cf703de17315471bb72548b08e2146b6c16d) Thanks [@sincspecv](https://github.com/sincspecv)! - Add provider-owned Google installed-app OAuth and OpenRouter PKCE API-key login flows.

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`0bf4049`](https://github.com/TheFancyRobot/fred/commit/0bf4049456bd2a41cc5fc46f56f9ca5a30db6f81) Thanks [@sincspecv](https://github.com/sincspecv)! - Report sanitized skipped rows from provider credential rotation batches and
  compute whether stale-key envelopes remain after row-level version races.

### Patch Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`784cc24`](https://github.com/TheFancyRobot/fred/commit/784cc24848cfdd617075ecb93935c32103878e74) Thanks [@sincspecv](https://github.com/sincspecv)! - Require a consumer-owned namespace for persisted provider-connection operations
  so shared PostgreSQL schemas isolate applications and workspaces.
