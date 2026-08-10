---
"@fancyrobot/fred-cli": minor
"@fancyrobot/fred-postgres": minor
---

Add a preflightable `fred postgres import-legacy` command that wraps the existing
copy-only importer, requires confirmation before writes, and reports verification
metadata without exposing database credentials.
