---
"@fancyrobot/fred-cli": patch
"@fancyrobot/fred": patch
---

Fix TUI session persistence, session picker UX, and slash command search

- Fix session persistence by delegating `listSessions()` to storage adapter
- Skip session picker when no previous sessions exist
- Add `/exit` command to command palette
- Lowercase all slash command labels
