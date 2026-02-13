---
phase: 31-cli-testing-debugging
plan: 02
subsystem: cli
tags: [mcp-commands, cli-wiring, server-lifecycle, debugging-tools]
dependency_graph:
  requires: [phase-31-01, phase-30-cli-commands]
  provides: [mcp-list-command, mcp-start-command, mcp-stop-command, mcp-status-command, cli-entrypoint-wiring]
  affects: [mcp-debugging-workflow, server-management-dx]
tech_stack:
  added: []
  patterns: [di-testing, effect-integration, registry-pattern]
key_files:
  created:
    - packages/cli/src/commands/mcp.ts
    - packages/cli/tests/commands/mcp.test.ts
  modified:
    - packages/core/src/mcp/registry.ts
    - packages/cli/src/index.ts
decisions:
  - title: Minimal MCPServerRegistry extensions
    choice: Added only getAllConfiguredServers() and getServerConfig() methods
    rationale: Keeps registry API focused; these are safe additions needed for CLI display
    alternatives: [expose-internal-maps, create-separate-query-service]
  - title: Tool count display limitation in list command
    choice: Show "-" for tool count in table view, omit from JSON
    rationale: listTools() is async and would slow down table display; status command provides detailed tool info
    alternatives: [eager-tool-discovery, cached-tool-counts]
  - title: Graceful error handling in batch operations
    choice: Continue processing all servers even if some fail in --all mode
    rationale: Matches user expectation for batch operations; errors are logged per-server
    alternatives: [fail-fast, transaction-semantics]
metrics:
  duration: 4.47
  completed: 2026-02-13T04:01:01Z
  commits: 3
  files_created: 2
  files_modified: 2
  tests_added: 17
---

# Phase 31 Plan 02: MCP Server Management Commands Summary

**One-liner:** CLI commands for managing MCP server lifecycles (list/start/stop/status) with batch operations and JSON output

## What Was Built

Implemented comprehensive MCP server management commands and wired all Phase 31 commands (intent, route, mcp) into the CLI entrypoint. Developers can now list, start, stop, and check health of MCP servers from the command line.

### MCP List Command

**Table output:**
```
ID          Status      Transport  Tools
filesystem  connected   stdio      -
web-search  stopped     http       -
```

**JSON output:**
```json
{
  "ok": true,
  "command": "mcp-list",
  "servers": [
    { "id": "filesystem", "status": "connected", "transport": "stdio" },
    { "id": "web-search", "status": "stopped", "transport": "http" }
  ]
}
```

**Features:**
- Shows all configured servers (both connected and lazy/never-started)
- Columns: ID, Status, Transport, Tools (tool count shows "-" in table view)
- Empty state: "No MCP servers configured."
- Exit code: always 0

### MCP Start Command

**Usage:**
```bash
fred mcp start filesystem-server
fred mcp start --all
```

**Features:**
- Start individual server by ID or all configured servers with `--all`
- Green success message: "Started: filesystem-server"
- Red error message with retry info on failure
- `--json` output with ok/error fields
- Exit codes: 0=success, 2=error

### MCP Stop Command

**Usage:**
```bash
fred mcp stop filesystem-server
fred mcp stop --all
```

**Features:**
- Stop individual server or all connected servers with `--all`
- Success message: "Stopped: filesystem-server"
- Graceful degradation: continues with other servers even if one fails
- `--json` output
- Exit codes: 0=success, 2=error

### MCP Status Command

**Human-readable output:**
```
Server: filesystem
Status: connected
Transport: stdio
Connected: yes
Uptime: N/A
Last error: none
Tool count: 3

Tools:
  - read_file: Read a file
  - write_file: Write a file
  - list_directory: List directory contents
```

**JSON output:**
```json
{
  "ok": true,
  "command": "mcp-status",
  "server": {
    "id": "filesystem",
    "status": "connected",
    "transport": "stdio",
    "connected": true,
    "toolCount": 3,
    "tools": [...]  // with --verbose
  }
}
```

**Features:**
- Shows connection health and tool count
- `--verbose` flag lists individual tools with descriptions
- `--json` output for CI integration
- Exit codes: 0=connected, 1=not-connected/not-found, 2=error

### MCPServerRegistry Extensions

Added two new public methods to `MCPServerRegistry`:

1. **`getAllConfiguredServers(): string[]`** - Returns union of connected server IDs and lazy config IDs (deduplicated). Enables `fred mcp list` to show all configured servers including those never started.

2. **`getServerConfig(id: string): MCPServerConfig | undefined`** - Returns config from either `servers` map or `lazyConfigs` map. Needed for displaying transport type and other config info.

These are minimal, safe additions that don't change existing behavior.

### CLI Entrypoint Wiring

Updated `packages/cli/src/index.ts`:
- Imported `handleIntentCommand`, `handleRouteCommand`, `handleMcpCommand`
- Added `threshold` to `OPTIONS_REQUIRING_VALUE` for intent test flag
- Added help text for all Phase 31 commands with usage examples
- Added switch cases to route intent/route/mcp commands

All Phase 31 debugging commands are now accessible via `fred` CLI.

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation

### DI Pattern Consistency

MCP command handler follows the established pattern from `list.ts` and `run.ts`:
- `McpCommandIO` interface for stdout/stderr abstraction
- `McpCommandDependencies` with optional `fred`, `io`, and `registry` overrides
- `DEFAULT_IO` constant for production use
- Enables clean testing without real MCP connections

### Subcommand Dispatch

1. Parse subcommand from `args[0]`: list, start, stop, status
2. Dispatch to specific handler function
3. Each handler validates arguments, gets registry, performs operation
4. Format output based on `--json`/`--verbose` flags
5. Return semantic exit code

### Effect Integration

All MCP operations use Effect for error handling:
- `ensureConnected()` returns `Effect<MCPClient, Error>`
- `removeServer()` returns `Effect<void, never>`
- `discoverTools()` returns `Effect<Tool[], Error>`
- Use `Effect.runPromise()` in CLI handler to execute
- Use `Effect.either()` for graceful error handling in batch operations

### Test Coverage

**MCP command tests (17 tests, 63 assertions):**

**List tests (4 tests):**
- Lists all configured servers with status and transport
- Shows empty message when no servers configured
- Returns JSON with --json flag
- Shows tool count for connected servers

**Start tests (4 tests):**
- Starts a server by ID
- Starts all servers with --all
- Returns exit 2 on start failure
- Returns exit 2 when server ID is missing

**Stop tests (3 tests):**
- Stops a server by ID
- Stops all servers with --all
- Returns exit 2 when server ID is missing

**Status tests (5 tests):**
- Shows connected server status with tool count
- Shows disconnected server status
- Returns exit 1 for not-found server
- Returns JSON status with --json
- Errors when server ID is missing

**Error tests (1 test):**
- Errors on unknown subcommand

## Verification Results

All success criteria met:

- [x] MCP list shows all configured servers (connected + lazy) with status and transport columns
- [x] MCP start/stop work for individual servers and --all batch mode
- [x] MCP status shows connection health and tool count for a specific server
- [x] All MCP commands support --json output
- [x] CLI entrypoint routes intent/route/mcp commands correctly
- [x] Help text documents all new commands
- [x] Exit codes: 0=success, 1=not-found/not-connected, 2=error
- [x] All tests pass with mock registry (no real MCP connections)
- [x] TypeScript compiles without errors
- [x] Regression tests still pass (intent, route, MCP core tests)

**Test execution:**
```
bun test packages/cli/tests/commands/mcp.test.ts
# 17 pass, 0 fail, 63 expect() calls

bun test packages/cli/tests/commands/intent.test.ts packages/cli/tests/commands/route.test.ts
# 20 pass, 0 fail, 80 expect() calls

bun test tests/unit/config/mcp-config.test.ts tests/unit/core/agent/mcp-factory.test.ts tests/unit/core/tool-gate/mcp-gating.test.ts
# 25 pass, 0 fail, 72 expect() calls
```

**Help text verification:**
```
fred --help
# Shows intent test, route test, and mcp commands with usage examples
```

## Files Created/Modified

### Created Files

1. **packages/cli/src/commands/mcp.ts** (365 lines)
   - MCP command handler with list/start/stop/status subcommands
   - Exports `handleMcpCommand(args, options, deps)`
   - Supports --json, --all, --verbose flags

2. **packages/cli/tests/commands/mcp.test.ts** (470 lines)
   - 17 unit tests for MCP commands
   - Mock MCPServerRegistry with Effect-based API
   - Covers all subcommands, flags, error cases

### Modified Files

1. **packages/core/src/mcp/registry.ts**
   - Added `getAllConfiguredServers()` method (returns union of connected and lazy server IDs)
   - Added `getServerConfig(id)` method (retrieves config from either map)

2. **packages/cli/src/index.ts**
   - Imported intent, route, and mcp command handlers
   - Added `threshold` to OPTIONS_REQUIRING_VALUE
   - Updated help text with all Phase 31 commands
   - Added switch cases for intent, route, mcp commands

## Next Steps

All Phase 31 commands are now complete and wired into the CLI:
- `fred intent test` - Test intent matching
- `fred route test` - Test routing decisions
- `fred mcp list/start/stop/status` - Manage MCP servers

Phase 31 is complete. Ready for Phase 32 (Plugin Architecture) or release of v0.2.1 milestone.

## Self-Check: PASSED

### Created Files Verification
```bash
[ -f "packages/cli/src/commands/mcp.ts" ] && echo "FOUND: packages/cli/src/commands/mcp.ts" || echo "MISSING: packages/cli/src/commands/mcp.ts"
# FOUND: packages/cli/src/commands/mcp.ts

[ -f "packages/cli/tests/commands/mcp.test.ts" ] && echo "FOUND: packages/cli/tests/commands/mcp.test.ts" || echo "MISSING: packages/cli/tests/commands/mcp.test.ts"
# FOUND: packages/cli/tests/commands/mcp.test.ts
```

### Modified Files Verification
```bash
git diff HEAD~3 packages/core/src/mcp/registry.ts | grep -q "getAllConfiguredServers" && echo "FOUND: getAllConfiguredServers" || echo "MISSING: getAllConfiguredServers"
# FOUND: getAllConfiguredServers

git diff HEAD~3 packages/cli/src/index.ts | grep -q "handleMcpCommand" && echo "FOUND: handleMcpCommand" || echo "MISSING: handleMcpCommand"
# FOUND: handleMcpCommand
```

### Commits Verification
```bash
git log --oneline --all | grep -q "bbc49c5" && echo "FOUND: bbc49c5" || echo "MISSING: bbc49c5"
# FOUND: bbc49c5

git log --oneline --all | grep -q "ebecc89" && echo "FOUND: ebecc89" || echo "MISSING: ebecc89"
# FOUND: ebecc89

git log --oneline --all | grep -q "5dd7ba1" && echo "FOUND: 5dd7ba1" || echo "MISSING: 5dd7ba1"
# FOUND: 5dd7ba1
```

All files exist and all commits are present in repository history.
