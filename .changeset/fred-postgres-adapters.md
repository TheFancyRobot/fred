---
"@fancyrobot/fred": major
"@fancyrobot/fred-http": major
"@fancyrobot/fred-cli": major
"@fancyrobot/fred-postgres": minor
---

Move PostgreSQL context and checkpoint adapters to `@fancyrobot/fred-postgres`.
Postgres tables now require explicit schema-qualified migrations; runtime stores
never create or adopt `public` tables. Use the documented copy-only legacy
import after a backup and rehearsal.
