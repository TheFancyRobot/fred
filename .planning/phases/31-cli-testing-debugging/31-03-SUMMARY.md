---
phase: 31-cli-testing-debugging
plan: 03
subsystem: cli-commands
tags: [gap-closure, error-messaging, exit-codes, testing]
dependency_graph:
  requires: [31-02]
  provides: [visible-exit-codes]
  affects: [cli-ux, debugging]
tech_stack:
  added: []
  patterns: [error-message-formatting, test-assertions]
key_files:
  created: []
  modified:
    - packages/cli/src/commands/intent.ts
    - packages/cli/src/commands/route.ts
    - packages/cli/src/commands/mcp.ts
    - packages/cli/tests/commands/intent.test.ts
    - packages/cli/tests/commands/route.test.ts
    - packages/cli/tests/commands/mcp.test.ts
decisions: []
metrics:
  duration_minutes: 2.12
  tasks_completed: 2
  files_modified: 6
  tests_added: 9
  completed_date: 2026-02-13
---

# Phase 31 Plan 03: Exit Code Visibility Summary

**One-liner:** Added visible exit codes to all CLI error messages in format "Error (exit N): description"

## What Was Built

Updated all Phase 31 CLI commands (intent, route, mcp) to include exit codes visibly in stderr error output. Previously, commands would exit with correct error codes (1 or 2) but users could not see the exit code in the error message text. Now all error messages follow the consistent pattern `Error (exit N): description`.

This gap closure addresses 5 of 10 UAT test expectations that were failing due to invisible exit codes.

## Task Completion

### Task 1: Add exit codes to stderr error messages ✓

**Files modified:**
- `packages/cli/src/commands/intent.ts` - 5 error paths updated
- `packages/cli/src/commands/route.ts` - 5 error paths updated
- `packages/cli/src/commands/mcp.ts` - 7 error paths updated

**Changes:**
- Updated all error messages from `Error: description` to `Error (exit N): description`
- Intent command: 5 error paths (missing message, init failure, no intents, matching failure, unknown subcommand)
- Route command: 5 error paths (missing message, init failure, routing failure, not configured, unknown subcommand)
- MCP command: 7 error paths (batch start failure, missing server ID for start/stop/status, start failure, server not found, unknown subcommand)

**Exit code semantics:**
- Exit code 2: Usage errors, configuration errors, operational failures
- Exit code 1: Semantic failures (server not found in mcp status, fallback routing, intent no-match)

### Task 2: Update test assertions ✓

**Files modified:**
- `packages/cli/tests/commands/intent.test.ts` - Added 3 assertions
- `packages/cli/tests/commands/route.test.ts` - Added 3 assertions
- `packages/cli/tests/commands/mcp.test.ts` - Added 6 assertions

**New assertions:**
Each test that expects a non-zero exit code now verifies the exit code is visible in stderr via `.toContain('exit N')` assertion. This ensures the error message format is consistently maintained.

**Test results:** All 37 tests pass (12 intent + 11 route + 14 mcp)

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. All 37 unit tests pass ✓
2. intent.ts contains 5 visible exit codes ✓
3. route.ts contains 5 visible exit codes ✓
4. mcp.ts contains 7 visible exit codes ✓
5. All existing tests continue to pass ✓
6. New assertions verify exit code visibility ✓

## UAT Impact

This change resolves 5 of 10 failing UAT tests from 31-UAT.md:
- `intent test` without message → now shows "Error (exit 2): Message required"
- `intent test` with no intents → now shows "Error (exit 2): No intents registered"
- `route test` without message → now shows "Error (exit 2): Message required"
- `mcp status` without server ID → now shows "Error (exit 2): Server ID is required"
- `mcp status` for missing server → now shows "Error (exit 1): Server ... not found"

All commands now provide clear, visible feedback about exit codes in error scenarios.

## Self-Check: PASSED

**Files verified:**
- ✓ packages/cli/src/commands/intent.ts exists and contains exit code messages
- ✓ packages/cli/src/commands/route.ts exists and contains exit code messages
- ✓ packages/cli/src/commands/mcp.ts exists and contains exit code messages
- ✓ packages/cli/tests/commands/intent.test.ts exists and contains exit code assertions
- ✓ packages/cli/tests/commands/route.test.ts exists and contains exit code assertions
- ✓ packages/cli/tests/commands/mcp.test.ts exists and contains exit code assertions

**Commits verified:**
- ✓ 25a387d: feat(31-03): add exit codes to all CLI error messages
- ✓ fe9772c: test(31-03): add assertions for exit codes in error output

**Test execution verified:**
- ✓ All 37 tests pass across 3 test files
