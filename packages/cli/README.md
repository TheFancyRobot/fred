# @fancyrobot/fred-cli

Command-line interface and interactive TUI for the [Fred](https://github.com/TheFancyRobot/fred) AI agent framework. Chat with agents, inspect resources, test intent routing, manage sessions, and run evaluations -- all from the terminal.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) before installing the
CLI prerelease alongside core or replacing `@fancyrobot/fred-dev`.

## Installation

The current Phase 68 Changesets plan produces CLI `0.6.0-alpha.1` in one
versioning pass because this repository's prerelease state already records
earlier `alpha.0` releases. Confirm the exact candidate in the published
migration matrix before release validation.

```bash
bun add -g @fancyrobot/fred-cli@0.6.0-alpha.1
```

Or use within a Fred project (installed as a workspace dependency):

```bash
bun add @fancyrobot/fred-cli@0.6.0-alpha.1 effect@^3.21.0
```

### Requirements

- [Bun](https://bun.sh) >= 1.0
- A Fred project with at least one configured provider

## Interactive Chat

```bash
fred chat
```

The former `fred dev` command is a deprecated alias for `fred chat` and will be
removed in the next major release. Development chat, provider auto-detection,
default-agent setup, config hot reload, and terminal cleanup are all owned by
this package.

The default command. Launches a full-screen TUI built on [OpenTUI](https://github.com/anthropics/opentui) with:

- **3-pane layout** -- session sidebar (toggleable), scrollable transcript, and input bar
- **Streaming output** -- token-by-token rendering with batched frames, tokens/sec tracking, and first-token latency
- **Markdown rendering** -- syntax-highlighted output with separate themes for streaming vs. final content
- **Session management** -- startup chooser (resume last or start new), sidebar session list, per-session draft preservation, lazy transcript loading
- **Tool call visualization** -- inline tool blocks with spinner animation, status indicators, expandable output
- **Command palette** -- Ctrl+K opens a fuzzy-searchable action palette with scope-aware commands
- **Slash commands** -- `/sidebar` or `/sb` toggles sidebar; plugins contribute additional slash commands
- **Pending submission queue** -- messages typed during streaming are queued and sent after completion
- **Clipboard** -- OSC52-based copy for transcript and last assistant response
- **Input features** -- blinking block cursor, input history (up/down), bracketed paste, multi-line editing (Shift+Enter)
- **Mouse scrolling** -- scroll transcript with mouse wheel (macOS scroll acceleration supported)
- **Help overlay** -- press F1 or `?` to see all keyboard shortcuts

### Project Setup Hook

If your project exports a `setup(fred)` function from `src/index.ts` or `index.ts`, the TUI executes it before starting the chat session. This lets you register agents, tools, and providers programmatically.

Legacy programmatic consumers can temporarily import `startDevChat` from the
package root. Provider/default-agent helpers are exported from
`@fancyrobot/fred-cli/chat-defaults`. Prefer the `fred chat` command for new code.

```ts
import { startDevChat } from '@fancyrobot/fred-cli';

await startDevChat(setup);
```

Await the returned promise so startup failures are observable and follow-up
cleanup does not run while the chat lifecycle is still active.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Tab / Shift+Tab | Cycle focus between panes |
| Ctrl+K | Command palette |
| Ctrl+B | Toggle sidebar |
| Ctrl+Shift+C | Copy transcript |
| Ctrl+Y | Copy last assistant message |
| PgUp / PgDn | Scroll transcript (10 lines) |
| Up / Down | Scroll transcript (1 line), navigate sessions, or browse input history |
| Enter | Submit message / select session |
| Shift+Enter | Insert newline in input |
| Escape / Ctrl+C | Quit |
| F1 / ? | Show help overlay |
| Delete / Backspace | Delete session (in sidebar) |

## Commands

### `fred run` -- Headless Execution

Run an agent non-interactively for CI/scripting.

```bash
fred run --agent assistant --input "What is 2+2?"
fred run --agent assistant --json < prompt.txt
```

| Flag | Description |
|---|---|
| `--agent <name>` | Agent to use (required) |
| `--input <msg>` | Message to send (or pipe via stdin) |
| `--json` | Structured JSON output (single document on stdout, zero on stderr) |
| `--verbose` | Show tool call details |
| `--conversation-id <id>` | Continue a prior conversation |

### `fred init` -- Scaffold a Project

```bash
fred init
```

Creates a minimal `fred.config.ts` with one agent and a calculator tool. Never overwrites existing files.

### `fred config validate` -- Validate Config

```bash
fred config validate
fred config validate --json
```

Validates your config file with Rust-compiler-style diagnostics:

```
error[missing-provider]: Agent "assistant" references provider "openai" which is not configured
  --> fred.config.ts:12:5
  = fix: Add provider "openai" to the providers section
```

Exit codes: 0 = valid, 1 = errors, 2 = warnings only.

### Resource Listing

```bash
fred agents              # List registered agents
fred tools               # List registered tools
fred intents             # List registered intents
fred providers           # List configured providers
fred workflows           # List defined workflows
```

All support `--json` for structured output.

### `fred intent test` -- Test Intent Matching

```bash
fred intent test "What is 2+2?"
fred intent test "Help me" --verbose --threshold 0.5
```

Shows matched intent, confidence score, and target agent. Exit codes: 0 = match, 1 = no match, 2 = error.

### `fred route test` -- Test Routing

```bash
fred route test "Help me with billing"
fred route test "Hello" --verbose --json
```

Shows routing decision, match type, and whether fallback was used. In verbose mode, shows the full decision chain with confidence scores, alternatives, and concerns.

### `fred mcp` -- MCP Server Management

```bash
fred mcp list                    # List servers with status
fred mcp start filesystem        # Connect a server
fred mcp stop filesystem         # Disconnect a server
fred mcp status filesystem       # Detailed info (--verbose shows tools)
fred mcp start --all             # Connect all configured servers
```

### `fred session` -- Session Management

```bash
fred session list                # Table of sessions
fred session list --json         # Structured output
fred session show conv_123       # Display transcript as markdown
fred session export conv_123 --format markdown --output transcript.md
fred session rm conv_123 conv_456   # Delete with confirmation
```

### `fred test` -- Golden Trace Testing

```bash
fred test                        # Run all golden trace tests
fred test --record "Hello!"     # Record a new trace
fred test --update               # Re-record existing traces
fred test mypattern              # Run tests matching pattern
```

Traces are stored in `tests/golden-traces/` (configurable with `--traces-dir`). Each trace captures complete execution including tool calls, routing, and agent responses for deterministic regression testing.

### `fred eval` -- Evaluation Workflows

```bash
fred eval record --run-id run-123
fred eval replay --trace-id trace-abc --from-step 2 --mode retry
fred eval compare --baseline trace-a --candidate trace-b
fred eval suite --suite ./eval/suite.yaml --output json
```

| Subcommand | Description |
|---|---|
| `record` | Capture an evaluation trace from an active run |
| `replay` | Re-execute a trace from a checkpoint (`--mode retry\|skip\|restart`) |
| `compare` | Diff two traces (exit 0 = pass, 2 = fail) |
| `suite` | Run a test suite manifest with aggregated metrics |

## Config Resolution

The CLI finds your config by walking upward from the working directory:

1. `fred.config.ts` (highest priority)
2. `fred.config.json`

In a monorepo, package-local config overrides workspace root. All resolution errors become structured diagnostics rather than crashes.

## Plugin System

Plugins extend the CLI with custom commands and TUI slash commands.

### Declaring Plugins

In your Fred config:

```typescript
// fred.config.ts
export default {
  plugins: [
    'my-fred-plugin',                          // npm package
    './plugins/local-plugin',                   // local path
    { id: 'custom', source: './my-plugin' },   // explicit declaration
  ],
};
```

### Writing a Plugin

Export a `FredCliPlugin` from your package:

```typescript
import type { FredCliPlugin } from '@fancyrobot/fred-cli/plugin';

const plugin: FredCliPlugin = {
  manifest: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    compatibility: {
      apiVersion: '1.0.0',
      requiresFredCli: '>=0.2.0',
    },
  },
  commands: [
    {
      name: 'greet',
      summary: 'Say hello',
      execute: async (args, ctx) => {
        ctx.stdout('Hello from my plugin!');
        return 0;
      },
    },
  ],
  slashCommands: [
    {
      name: 'hello',
      summary: 'Greeting slash command',
      execute: async (args) => 'Hello!',
    },
  ],
};

export default plugin;
```

Plugin commands are accessible as `fred greet` and slash commands as `/my-plugin:hello` in the TUI. Plugin commands appear in `fred help`.

### Plugin Validation

Plugins are validated at startup using semver compatibility checks. If validation fails, the CLI reports structured diagnostics and exits with code 12.

If your plugin currently pins `requiresFredCli: '^0.2.0'`, widen it before adopting
`@fancyrobot/fred-cli@0.3.x`:

```ts
requiresFredCli: '^0.2.0 || ^0.3.0'
```

## Global Options

| Flag | Description |
|---|---|
| `--config <file>` | Path to Fred config file |
| `--json` | Structured JSON output (most commands) |
| `--traces-dir <dir>` | Golden trace directory (default: `tests/golden-traces`) |

## Development

```bash
# Run CLI tests
bun test packages/cli/tests/

# Build
bun run build --filter @fancyrobot/fred-cli
```

## License

MIT
