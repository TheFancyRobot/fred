---
phase: 31-cli-testing-debugging
plan: 01
subsystem: cli
tags: [intent-testing, routing-debugging, tty-color, cli-commands]
dependency_graph:
  requires: [phase-30-cli-commands]
  provides: [intent-test-command, route-test-command, color-utility]
  affects: [cli-testing-workflow, debugging-experience]
tech_stack:
  added: [ansi-color-codes]
  patterns: [tty-aware-output, semantic-exit-codes, di-testing]
key_files:
  created:
    - packages/cli/src/commands/color.ts
    - packages/cli/src/commands/intent.ts
    - packages/cli/src/commands/route.ts
    - packages/cli/tests/commands/intent.test.ts
    - packages/cli/tests/commands/route.test.ts
  modified:
    - packages/cli/src/commands/intent.ts
decisions:
  - title: Use Fred's internal intentMatcher
    choice: Access fred.intentMatcher directly instead of creating new matcher instance
    rationale: Avoids export complexity and uses existing matcher with registered intents
    alternatives: [export-intent-matcher-module, create-fresh-matcher]
  - title: Inline ANSI codes instead of external library
    choice: Direct ANSI escape sequences in color utility
    rationale: Zero dependencies, lightweight, sufficient for CLI color needs
    alternatives: [chalk, picocolors]
  - title: Effect-based mock in tests
    choice: Mock intentMatcher.matchIntent to return Effect.succeed()
    rationale: Matches real Effect-based API behavior for accurate testing
    alternatives: [promise-based-mock, sync-mock]
metrics:
  duration: 4.56
  completed: 2026-02-13T03:53:34Z
  commits: 2
  files_created: 5
  files_modified: 1
  tests_added: 20
---

# Phase 31 Plan 01: Intent and Route Testing Commands Summary

**One-liner:** CLI commands for testing intent matching and routing decisions with TTY-aware color output and JSON support

## What Was Built

Implemented `fred intent test` and `fred route test` commands to enable developers to debug intent matching and routing decisions from the command line. Both commands support human-readable color output for interactive use and structured JSON output for CI pipelines.

### Intent Test Command

**Compact single-line default output:**
```
greeting (1.00) -> assistant
```

**Verbose mode with alternatives and timing:**
```
greeting (1.00) -> assistant

Alternatives:
  farewell (0.80)
  help (0.65)

Duration: 12ms
Config: /path/to/fred.config.yaml
```

**JSON output:**
```json
{
  "ok": true,
  "matched": true,
  "intent": "greeting",
  "confidence": 1.0,
  "agent": "assistant"
}
```

**Features:**
- TTY-aware color: green for match, yellow for low confidence, red for no match
- Confidence displayed as decimal (0.87), not percentage
- `--verbose` flag shows alternatives with scores, timing, config path
- `--threshold <float>` filters low-confidence alternatives
- `--json` outputs structured data for CI integration
- Semantic exit codes: 0=match, 1=no-match, 2=error

### Route Test Command

**Compact default output (final result only):**
```
-> assistant
-> default-assistant (fallback)
```

**Verbose mode with full decision chain:**
```
-> assistant

Decision:
Matched greeting pattern with high confidence

Match details:
  Type: regex
  Confidence: 0.95

Alternatives:
  helper (0.75)

Duration: 8ms
Config: /path/to/fred.config.yaml
```

**JSON output:**
```json
{
  "ok": true,
  "agent": "assistant",
  "fallback": false
}
```

**Features:**
- Color: green for direct match, yellow for fallback
- `--verbose` shows narrative, match details, alternatives, concerns, timing
- `--json` outputs structured data
- Semantic exit codes: 0=direct match, 1=fallback, 2=error

### Color Utility

Shared TTY-aware color utility (`packages/cli/src/commands/color.ts`):
- Auto-detects TTY via `process.stdout.isTTY`
- Returns plain text when piped or redirected
- Provides `green`, `yellow`, `red`, `gray`, `bold` methods
- Zero dependencies, inline ANSI escape codes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed submodule import issue**
- **Found during:** Task 1 implementation
- **Issue:** `@fancyrobot/fred/intent/matcher` not exported in package.json exports
- **Fix:** Used Fred's internal `intentMatcher` directly via `(fred as any).intentMatcher.matchIntent()`
- **Files modified:** packages/cli/src/commands/intent.ts
- **Commit:** 68fd3f4

**2. [Rule 3 - Blocking] Fixed test mock Effect compatibility**
- **Found during:** Task 2 test execution
- **Issue:** Mock intentMatcher returned Promise, real API returns Effect
- **Fix:** Updated mock to return `Effect.succeed()` for accurate behavior matching
- **Files modified:** packages/cli/tests/commands/intent.test.ts
- **Commit:** 68fd3f4

**3. [Rule 2 - Missing critical functionality] Added debug output in first test**
- **Found during:** Task 2 debugging
- **Issue:** Test failures didn't show error messages for troubleshooting
- **Fix:** Added console.log for errors/output when test fails
- **Files modified:** packages/cli/tests/commands/intent.test.ts
- **Commit:** 68fd3f4

## Technical Implementation

### DI Pattern Consistency

Both commands follow the established DI pattern from `list.ts` and `run.ts`:
- `*CommandIO` interface for stdout/stderr abstraction
- `*CommandDependencies` with optional `fred` and `io` overrides
- `DEFAULT_IO` constant for production use
- Enables clean testing without real Fred instantiation

### Intent Matching Flow

1. Validate message argument (return 2 if missing)
2. Initialize Fred from config
3. Get intents via `fred.getIntents()`
4. Use Fred's internal `intentMatcher.matchIntent()` (returns Effect)
5. Format output based on `--json`/`--verbose` flags
6. Return semantic exit code

### Route Testing Flow

1. Validate message argument
2. Initialize Fred
3. Call `fred.testRoute(message, {})` (dry-run mode, no hooks)
4. Handle null (routing not configured) → error
5. Format output based on match/fallback/explanation
6. Return semantic exit code

### Test Coverage

**Intent command tests (10 tests, 36 assertions):**
- Compact output on match
- JSON output on match
- Exit code 1 on no match
- Verbose output with alternatives
- Threshold filtering
- Exit code 2 when message missing
- JSON output on no match
- Unknown subcommand error
- Verbose JSON includes extra fields
- Exit code 2 when no intents registered

**Route command tests (10 tests, 44 assertions):**
- Compact output on direct match
- Yellow output on fallback
- JSON output
- Verbose output with explanation
- Exit code 1 on fallback
- Exit code 2 when routing not configured
- Exit code 2 when message missing
- Verbose JSON includes explanation
- Unknown subcommand error
- Concerns display in verbose mode

## Verification Results

All success criteria met:

- [x] Intent test command produces compact single-line output with color
- [x] Route test command produces final-result output with color
- [x] Confidence scores displayed as decimal (0.87), not percentage
- [x] TTY-aware color: green for match, yellow for low confidence/fallback, red for no match
- [x] All tests pass (20 tests, 80 assertions)
- [x] Exit codes: 0=match, 1=no-match/fallback, 2=error
- [x] `--json` and `--verbose` flags work correctly
- [x] TypeScript compiles without errors

**Test execution:**
```
bun test packages/cli/tests/commands/intent.test.ts
# 10 pass, 0 fail, 36 expect() calls

bun test packages/cli/tests/commands/route.test.ts
# 10 pass, 0 fail, 44 expect() calls
```

## Files Created/Modified

### Created Files

1. **packages/cli/src/commands/color.ts** (41 lines)
   - TTY-aware color utility with ANSI escape codes
   - Exports `createColors(isTTY?: boolean)` function

2. **packages/cli/src/commands/intent.ts** (192 lines)
   - Intent test command handler
   - Exports `handleIntentCommand(args, options, deps)`

3. **packages/cli/src/commands/route.ts** (208 lines)
   - Route test command handler
   - Exports `handleRouteCommand(args, options, deps)`

4. **packages/cli/tests/commands/intent.test.ts** (285 lines)
   - 10 unit tests for intent command
   - Effect-based mock for intentMatcher

5. **packages/cli/tests/commands/route.test.ts** (336 lines)
   - 10 unit tests for route command
   - Inline type definitions to avoid submodule imports

### Modified Files

1. **packages/cli/src/commands/intent.ts**
   - Fixed import paths to use Fred's internal intentMatcher
   - Updated to return Effect-compatible results

## Next Steps

Integration into CLI entrypoint (`packages/cli/src/index.ts`) will be handled in Plan 02 (CLI wiring).

Commands ready for:
- Help text registration
- Argument parsing via commander/cac
- End-to-end testing with real Fred config

## Self-Check: PASSED

### Created Files Verification
```bash
[ -f "packages/cli/src/commands/color.ts" ] && echo "FOUND: packages/cli/src/commands/color.ts" || echo "MISSING: packages/cli/src/commands/color.ts"
# FOUND: packages/cli/src/commands/color.ts

[ -f "packages/cli/src/commands/intent.ts" ] && echo "FOUND: packages/cli/src/commands/intent.ts" || echo "MISSING: packages/cli/src/commands/intent.ts"
# FOUND: packages/cli/src/commands/intent.ts

[ -f "packages/cli/src/commands/route.ts" ] && echo "FOUND: packages/cli/src/commands/route.ts" || echo "MISSING: packages/cli/src/commands/route.ts"
# FOUND: packages/cli/src/commands/route.ts

[ -f "packages/cli/tests/commands/intent.test.ts" ] && echo "FOUND: packages/cli/tests/commands/intent.test.ts" || echo "MISSING: packages/cli/tests/commands/intent.test.ts"
# FOUND: packages/cli/tests/commands/intent.test.ts

[ -f "packages/cli/tests/commands/route.test.ts" ] && echo "FOUND: packages/cli/tests/commands/route.test.ts" || echo "MISSING: packages/cli/tests/commands/route.test.ts"
# FOUND: packages/cli/tests/commands/route.test.ts
```

### Commits Verification
```bash
git log --oneline --all | grep -q "099921b" && echo "FOUND: 099921b" || echo "MISSING: 099921b"
# FOUND: 099921b

git log --oneline --all | grep -q "68fd3f4" && echo "FOUND: 68fd3f4" || echo "MISSING: 68fd3f4"
# FOUND: 68fd3f4
```

All files exist and all commits are present in repository history.
