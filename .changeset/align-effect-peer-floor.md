---
"@fancyrobot/fred": patch
"@fancyrobot/fred-cli": patch
"@fancyrobot/fred-baml": patch
"@fancyrobot/fred-convex": patch
"@fancyrobot/fred-http": patch
"@fancyrobot/fred-anthropic": patch
"@fancyrobot/fred-google": patch
"@fancyrobot/fred-groq": patch
"@fancyrobot/fred-minimax": patch
"@fancyrobot/fred-openai": patch
"@fancyrobot/fred-openrouter": patch
---

Require `effect@^3.21.5` across the release set because `@effect/platform@0.96.3`
declares that peer floor. This is a compatibility boundary; no upstream
vulnerability is being claimed for Effect 3.21.0 through 3.21.4.
