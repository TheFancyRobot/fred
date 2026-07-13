---
"@fancyrobot/fred": patch
"@fancyrobot/fred-http": patch
"@fancyrobot/fred-google": patch
"@fancyrobot/fred-groq": patch
"@fancyrobot/fred-minimax": patch
---

Require `effect@^3.21.5` in packages that directly peer on
`@effect/platform@0.96.3`, which declares that Effect peer floor. This is a
compatibility boundary; no upstream vulnerability is being claimed for Effect
3.21.0 through 3.21.4.
