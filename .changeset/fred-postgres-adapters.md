---
"@fancyrobot/fred": minor
"@fancyrobot/fred-http": minor
"@fancyrobot/fred-cli": minor
"@fancyrobot/fred-postgres": minor
---

Add `@fancyrobot/fred-postgres` as the canonical PostgreSQL adapter and migration
package. Existing core adapters and `fred-http` PostgreSQL stores remain
functional for this v2 release, but emit a deprecation warning (or use the
explicit `schema` option for the new schema-qualified path). Migrate after a
backup and rehearsal; removal is deferred to the next major release.
