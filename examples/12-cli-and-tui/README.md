# 12 - CLI & TUI: Interactive Development

This example focuses on Fred's interactive CLI/TUI workflow using a config-first setup.

## What you'll learn

- Use `fred chat` for interactive TUI sessions
- Use `fred run` for headless one-shot execution
- Navigate session and agent context in the TUI
- Run Fred from `config.yaml` + `agents/*.md` without writing orchestration code

## Why this matters

Fred includes a polished built-in TUI, which is rare among agent frameworks. You can inspect context, switch focus, and iterate quickly from the terminal.

## Prerequisites

- Bun installed
- Fred CLI available in your shell
- `OPENROUTER_API_KEY` configured

## Step-by-step walkthrough

1. Install dependencies:

   ```bash
   bun install
   cp .env.example .env
   # edit .env and set OPENROUTER_API_KEY
   ```

2. Start the TUI:

   ```bash
   fred chat --config ./config.yaml
   ```

3. Navigate with keyboard shortcuts:
   - `Ctrl+B` to toggle sidebar
   - `Tab` to move focus between panes
   - Arrow keys to move through selectable items

4. Inspect agents and tools in the sidebar:
    - Confirm `assistant` and `coder` are loaded
    - Send messages like "help with debugging" to observe intent-driven routing

## Agent definition layout

- `agents/assistant.md` and `agents/coder.md` define prompts + frontmatter
- `coder.md` includes `utterances` for intent routing
- `config.yaml` now focuses on provider + routing (no inline `agents:` block)

5. Run headlessly:

   ```bash
   fred run --config ./config.yaml --message "Hello"
   ```

6. Session management:
   - Use the TUI session/history views to revisit conversations
   - Export conversations from the CLI when needed

## Screenshots

No static screenshots are included here. Run the commands above to experience the live TUI directly.

## Related example

See Example 10 (`10-config-driven-yaml`) for deeper details on config structure and programmatic equivalence.
