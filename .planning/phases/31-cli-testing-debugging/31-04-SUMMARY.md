---
phase: 31-cli-testing-debugging
plan: 04
subsystem: cli/commands
tags:
  - json-output
  - error-handling
  - gap-closure
  - uat-fix
dependency-graph:
  requires: []
  provides:
    - consistent-json-error-output
  affects:
    - intent-command
    - route-command
    - mcp-command
tech-stack:
  added: []
  patterns:
    - exclusive-output-channels
    - json-aware-error-paths
key-files:
  created: []
  modified:
    - packages/cli/src/commands/intent.ts
    - packages/cli/src/commands/route.ts
    - packages/cli/src/commands/mcp.ts
    - packages/cli/tests/commands/intent.test.ts
    - packages/cli/tests/commands/route.test.ts
    - packages/cli/tests/commands/mcp.test.ts
decisions:
  - decision: Use exclusive output channels (JSON to stdout OR plain text to stderr, never both)
    rationale: Prevents mixed output that breaks JSON parsers in scripting contexts
    alternatives: []
    impact: Clean, parseable output in both interactive and scripting modes
  - decision: Strip "Error (exit N):" prefix from JSON error messages
    rationale: Prefix is for human-readable output only; JSON consumers parse exit codes separately
    alternatives: []
    impact: Cleaner JSON error messages without redundant formatting
metrics:
  duration: 4.12 min
  tasks-completed: 3
  tests-added: 10
  tests-passing: 47
  completed-date: 2026-02-13
---

# Phase 31 Plan 04: JSON Error Path Consistency

**One-liner:** All CLI commands (intent, route, mcp) now output valid JSON exclusively when --json is set, with no stderr leakage

## Summary

Fixed UAT test 7 failure by making all error paths in intent.ts, route.ts, and mcp.ts respect the --json flag. Previously, success paths correctly output JSON, but error paths always wrote plain text to stderr regardless of the --json flag. This broke JSON parsers and violated the contract that --json mode provides machine-readable output.

Applied a consistent pattern across all three commands: when --json is true, output `{ "ok": false, "error": "..." }` to stdout; otherwise, output plain text to stderr. For mcp.ts, also ensured success paths are exclusive (no mixing of plain text and JSON).

## Tasks Completed

### Task 1: Fix error paths in intent.ts and route.ts to respect --json
- **Files:** intent.ts, route.ts
- **Changes:**
  - Fixed 5 error paths in intent.ts: missing message, Fred init failure, no intents registered, intent matching failed, unknown subcommand
  - Fixed 5 error paths in route.ts: missing message, Fred init failure, routing failed, routing not configured, unknown subcommand
  - Applied exclusive pattern: `if (options.json) { io.stdout(JSON.stringify({ok:false, error})) } else { io.stderr(...) }`
  - Removed "Error (exit N):" prefix from JSON error messages
- **Verification:** All existing tests pass unchanged (they exercise the else branch)
- **Commit:** c351ef9

### Task 2: Fix error paths in mcp.ts to use exclusive JSON output
- **Files:** mcp.ts
- **Changes:**
  - Fixed 9 error paths to use exclusive output (no mixing of stderr and JSON)
  - Made success paths exclusive as well (start --all, start single, stop --all, stop single)
  - Removed extra stderr hint line from JSON branch in start failure
  - Added JSON handling to unknown subcommand and catch-all error paths
  - Added `command` field to JSON error output for consistency with success paths
- **Verification:** All existing tests pass unchanged
- **Commit:** 4d58c56

### Task 3: Add tests for --json error output in all three command files
- **Files:** intent.test.ts, route.test.ts, mcp.test.ts
- **Changes:**
  - Added 3 tests to intent.test.ts: missing message, no intents registered, unknown subcommand
  - Added 3 tests to route.test.ts: missing message, routing not configured, unknown subcommand
  - Added 4 tests to mcp.test.ts: missing server ID (start/stop/status), unknown subcommand
  - All tests verify: exit code 2, valid JSON output with `ok: false`, no stderr leakage (`captured.errors.length === 0`)
- **Verification:** All 47 tests pass (37 existing + 10 new)
- **Commit:** d0e9c38

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. **All tests pass:** `bun test` for all three command files exits 0 with 47 passing tests
2. **No unguarded stderr calls:** Grep verification confirms all `io.stderr` calls in error paths are inside `else` branches after `options.json` checks (except non-error logging in initializeFred helpers and warning messages)
3. **UAT test 7 will now pass:** `fred intent test "hello" --json` (when no intents are registered) outputs valid JSON instead of plain text

## Success Criteria Met

- [x] Zero stderr output when --json flag is set, for any error condition in intent, route, or mcp commands
- [x] All JSON error output follows `{ "ok": false, "error": "descriptive message" }` shape (mcp adds `command` field)
- [x] All existing tests pass unchanged
- [x] 10 new tests prove the --json error behavior
- [x] `bun test` for all three test files exits 0

## Impact

### User-Facing Changes
- **JSON mode reliability:** `--json` flag now works consistently for all output (success AND error paths)
- **Scripting support:** CLI commands can be safely used in scripts with `--json` flag and proper exit code checking
- **No breaking changes:** Non-JSON mode behavior unchanged; existing scripts without `--json` flag work identically

### Technical Debt
- None introduced; this change reduces technical debt by fixing inconsistent error handling

### Documentation
- No documentation updates needed; `--json` flag already documented, this just fixes its implementation

## Self-Check: PASSED

**Verified created files:**
```bash
# No files created (only modified existing files)
```

**Verified commits exist:**
```bash
git log --oneline --all | grep "c351ef9"  # FOUND: c351ef9 fix(31-04): add JSON-aware error paths
git log --oneline --all | grep "4d58c56"  # FOUND: 4d58c56 fix(31-04): make MCP command output exclusive
git log --oneline --all | grep "d0e9c38"  # FOUND: d0e9c38 test(31-04): add JSON error output tests
```

**Verified modified files exist and contain changes:**
- [x] packages/cli/src/commands/intent.ts - contains 5 JSON-guarded error paths
- [x] packages/cli/src/commands/route.ts - contains 5 JSON-guarded error paths
- [x] packages/cli/src/commands/mcp.ts - contains 9 exclusive error/success paths
- [x] packages/cli/tests/commands/intent.test.ts - contains 3 new JSON error tests
- [x] packages/cli/tests/commands/route.test.ts - contains 3 new JSON error tests
- [x] packages/cli/tests/commands/mcp.test.ts - contains 4 new JSON error tests

All task commits verified, all files modified as expected, all tests passing.
