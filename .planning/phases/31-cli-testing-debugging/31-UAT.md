---
status: complete
phase: 31-cli-testing-debugging
source: [31-01-SUMMARY.md, 31-02-SUMMARY.md]
started: 2026-02-12T12:00:00Z
updated: 2026-02-12T12:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. CLI help shows all Phase 31 commands
expected: Running `fred --help` shows intent test, route test, and mcp commands in the help text with usage descriptions and examples.
result: pass

### 2. Intent test shows error when message missing
expected: Running `fred intent test` (no message argument) prints an error to stderr like "Error: Message required. Usage: fred intent test \"message\"" and exits with code 2.
result: issue
reported: "error message is correct but no error code is reported"
severity: minor

### 3. Intent test matches an intent from config
expected: Running `fred intent test "hello"` against a project with intents configured shows a compact single-line output like `greeting (1.00) -> assistant` with the matched intent ID, confidence as decimal, and target agent.
result: issue
reported: "error message is correct but error code is missing"
severity: minor

### 4. Intent test JSON output
expected: Running `fred intent test "hello" --json` outputs a JSON object with `{ "ok": true, "matched": true, "intent": "...", "confidence": ..., "agent": "..." }` structure.
result: skipped
reason: No intents configured in project

### 5. Route test shows error when message missing
expected: Running `fred route test` (no message argument) prints an error to stderr and exits with code 2.
result: issue
reported: "message is correct but exit code is missing"
severity: minor

### 6. Route test shows routing decision
expected: Running `fred route test "hello"` against a project with routing configured shows compact output like `-> agentName` with green color in TTY.
result: issue
reported: "message is correct but exit code is missing"
severity: minor

### 7. Route test JSON output
expected: Running `fred route test "hello" --json` outputs a JSON object with `{ "ok": true, "agent": "...", "fallback": false }` structure.
result: skipped
reason: No routing configured in project

### 8. MCP list shows configured servers
expected: Running `fred mcp list` shows table of servers or "No MCP servers configured." for empty state.
result: pass

### 9. MCP status for a specific server
expected: Running `fred mcp status <server-id>` shows server details or "Server not found" error.
result: issue
reported: "message is correct but exit code is missing"
severity: minor

### 10. All Phase 31 unit tests pass
expected: Running `bun test packages/cli/tests/commands/intent.test.ts packages/cli/tests/commands/route.test.ts packages/cli/tests/commands/mcp.test.ts` — all 37 tests pass with 0 failures.
result: pass

## Summary

total: 10
passed: 3
issues: 5
pending: 0
skipped: 2

## Gaps

- truth: "CLI commands report exit code visibly when exiting with non-zero status"
  status: failed
  reason: "User reported: error messages are correct but exit codes are not reported visibly in output across intent test, route test, and mcp status commands"
  severity: minor
  test: 2, 3, 5, 6, 9
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
