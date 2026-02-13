---
status: complete
phase: 31-cli-testing-debugging
source: [31-01-SUMMARY.md, 31-02-SUMMARY.md, 31-03-SUMMARY.md]
started: 2026-02-13T05:30:00Z
updated: 2026-02-13T05:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Intent test shows matched intent with confidence
expected: Run `fred intent test "hello"` in the project root. You should see a compact single-line output like `greeting (1.00) -> assistant` showing matched intent ID, confidence as decimal, and target agent name. If no intents are configured, you should see an error message containing "Error (exit 2)" indicating the exit code visibly.
result: pass

### 2. Intent test error shows visible exit code
expected: Run `fred intent test` (no message). You should see an error like "Error (exit 2): Message required. Usage: fred intent test \"message\"" — the key thing is that "(exit 2)" appears visibly in the error text.
result: pass

### 3. Route test shows routing decision
expected: Run `fred route test "hello"`. You should see compact output like `-> agentName` (green in TTY). If routing isn't configured, you should see an error message containing "Error (exit 2)" with visible exit code.
result: pass

### 4. Route test error shows visible exit code
expected: Run `fred route test` (no message). You should see "Error (exit 2): Message required" with the exit code visible in the error text.
result: pass

### 5. MCP list shows servers or empty state
expected: Run `fred mcp list`. You should see either a table of configured servers (ID, Status, Transport, Tools columns) or "No MCP servers configured." for empty state.
result: pass

### 6. MCP status error shows visible exit code
expected: Run `fred mcp status` (no server ID). You should see "Error (exit 2): Server ID is required" with the exit code visible in the error text.
result: pass

### 7. JSON output works for intent test
expected: Run `fred intent test "hello" --json`. Output should be valid JSON with at minimum an `ok` field. If intents exist: `{ "ok": true, "matched": ..., "intent": ..., "confidence": ... }`. If no intents: `{ "ok": false, "error": ... }`.
result: issue
reported: "no json on error — running fred intent test \"hello\" --json outputs plain text 'Error (exit 2): No intents registered.' instead of JSON"
severity: major

### 8. CLI help shows all Phase 31 commands
expected: Run `fred --help`. The help text should list `intent test`, `route test`, and `mcp` commands with brief descriptions and usage examples.
result: pass

### 9. All Phase 31 unit tests pass
expected: Run `bun test packages/cli/tests/commands/intent.test.ts packages/cli/tests/commands/route.test.ts packages/cli/tests/commands/mcp.test.ts`. All tests should pass with 0 failures.
result: pass

## Summary

total: 9
passed: 8
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "When --json flag is passed, all output including errors should be valid JSON"
  status: failed
  reason: "User reported: no json on error — running fred intent test \"hello\" --json outputs plain text 'Error (exit 2): No intents registered.' instead of JSON"
  severity: major
  test: 7
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
