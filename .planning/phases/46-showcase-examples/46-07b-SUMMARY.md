---
phase: 46-showcase-examples
plan: 07b
subsystem: examples
tags: [examples, mcp, cli, tui, config]

requires:
  - phase: 46-01
    provides: examples workspace scaffold and guard foundation
  - phase: 46-02
    provides: Fred facade API prerequisites used by examples
provides:
  - Self-contained Example 11 for MCP server integration with auto-tool-discovery wiring
  - Self-contained Example 12 for CLI/TUI walkthrough with runnable config.yaml
  - README guidance for MCP server-down handling and CLI session-driven usage
affects: [46-08, examples, docs]

tech-stack:
  added: []
  patterns: [self-contained example packaging, MCP status preflight checks before agent execution]

key-files:
  created:
    - examples/11-mcp-integration/package.json
    - examples/11-mcp-integration/README.md
    - examples/11-mcp-integration/.env.example
    - examples/11-mcp-integration/tsconfig.json
    - examples/11-mcp-integration/src/index.ts
    - examples/12-cli-and-tui/package.json
    - examples/12-cli-and-tui/README.md
    - examples/12-cli-and-tui/.env.example
    - examples/12-cli-and-tui/tsconfig.json
    - examples/12-cli-and-tui/config.yaml
    - examples/12-cli-and-tui/src/index.ts
  modified: []

key-decisions:
  - "Example 11 uses Fred.configureMCPServers(array) plus agent mcpServers mapping so MCP tools are discovered automatically during agent construction"
  - "Example 12 config includes routing.rules as an explicit empty list to satisfy FrameworkConfig validation while keeping default-agent behavior"

patterns-established:
  - "MCP example safety: check registry server status and short-circuit with recovery guidance when disconnected"
  - "CLI/TUI examples remain code-light in src/index.ts and put interaction depth in README walkthrough"

duration: 2 min
completed: 2026-03-02
---

# Phase 46 Plan 07b: Examples 11 and 12 Summary

**MCP integration and CLI/TUI learning-path examples are now fully scaffolded as standalone workspace packages, including runnable entrypoints, env templates, and operational README walkthroughs.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T23:41:26Z
- **Completed:** 2026-03-02T23:44:09Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Created Example 11 (`11-mcp-integration`) with MCP server configuration, agent-side auto-discovery wiring via `mcpServers`, and explicit disconnected-server handling.
- Created Example 12 (`12-cli-and-tui`) with a valid demo `config.yaml`, minimal launcher script using `initializeFromConfig`, and a full interactive CLI/TUI README walkthrough.
- Added complete per-example package scaffolding (`package.json`, `.env.example`, `tsconfig.json`) for both examples.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Example 11 - MCP Integration** - `95492fb` (feat)
2. **Task 2: Create Example 12 - CLI and TUI** - `87e8c8b` (feat)

## Files Created/Modified
- `examples/11-mcp-integration/src/index.ts` - End-to-end MCP setup, auto-discovery agent wiring, and server-down handling.
- `examples/11-mcp-integration/README.md` - MCP usage, prerequisites, and recovery guidance.
- `examples/12-cli-and-tui/config.yaml` - Demo provider/agent/intent/routing configuration for immediate CLI use.
- `examples/12-cli-and-tui/src/index.ts` - Minimal config-driven launcher using `initializeFromConfig('./config.yaml')`.
- `examples/12-cli-and-tui/README.md` - Scripted walkthrough for `fred chat` and `fred run` workflows.

## Decisions Made
- Used `configureMCPServers` with the current Fred API shape (array of server configs including `id`) instead of the older object wrapper pattern.
- Modeled tool auto-discovery through `mcpServers: ['filesystem']` on the agent, matching AgentFactory's MCP discovery path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `routing.rules: []` to Example 12 config**
- **Found during:** Task 2 (Create Example 12 - CLI and TUI)
- **Issue:** The plan snippet omitted `routing.rules`, but `RoutingConfig` validation requires `rules` to be an array.
- **Fix:** Added `rules: []` under `routing` while preserving default-agent behavior.
- **Files modified:** `examples/12-cli-and-tui/config.yaml`
- **Verification:** Config shape now satisfies loader validation requirements.
- **Committed in:** `87e8c8b`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required for config correctness; no scope expansion.

## Issues Encountered

- Running `bunx tsc --noEmit -p examples/11-mcp-integration/tsconfig.json` (and Example 12) surfaced pre-existing repository TypeScript and Effect language-service diagnostics in core packages. This plan did not modify those package files.

## User Setup Required

None - no external service configuration required beyond example-local `.env` values.

## Next Phase Readiness

Ready for subsequent Phase 46 example authoring/finalization work; Example 11 and 12 artifacts are in place with required structure and package import conventions.

---
*Phase: 46-showcase-examples*
*Completed: 2026-03-02*
