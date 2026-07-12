---
"@fancyrobot/fred-cli": minor
"@fancyrobot/fred-dev": major
"@fancyrobot/fred": patch
---

Move development chat, provider/default-agent helpers, setup loading, hot reload,
and lifecycle ownership into `@fancyrobot/fred-cli`. Publish
`@fancyrobot/fred-dev` as a final deprecated re-export shim with migration
guidance before removing it in the next major release.

Declare the core comparison runtime dependencies required when packed CLI
consumers load Fred through Bun's source export condition.
