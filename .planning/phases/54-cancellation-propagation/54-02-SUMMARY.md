---
phase: 54-cancellation-propagation
plan: 02
subsystem: core, cli
tags: [retry, backoff, timeout, abort-signal, stream, effect-stream, cancellation]

# Dependency graph
requires:
  - phase: 54-cancellation-propagation
    provides: patient timeout mode for stream timeouts (plan 01)
provides:
  - Longer retry backoff for tool timeout errors (timeoutBackoffMs)
  - AbortSignal-based stream cancellation on explicit user exit
affects: [cli, core-streaming, agent-factory]

# Tech tracking
tech-stack:
  added: []
  patterns: [AbortSignal-to-Effect-Stream interruption via Stream.interruptWhen, timeout-aware retry backoff]

key-files:
  created:
    - tests/unit/core/stream/abort-signal.test.ts
  modified:
    - packages/core/src/agent/agent.ts
    - packages/core/src/agent/factory.ts
    - packages/core/src/message-processor/types.ts
    - packages/core/src/index.ts
    - packages/cli/src/commands/chat.ts
    - tests/unit/core/agent/factory.test.ts

key-decisions:
  - "Timeout backoff uses 15s default base delay with 30s max, separate from normal 1s/10s backoff"
  - "AbortSignal threaded through ProcessingOptions and converted to Effect Stream interruption via Stream.interruptWhen"
  - "onQuit handler aborts active stream controller before process.exit"

patterns-established:
  - "AbortSignal-to-Effect-Stream: wrap signal in Effect.async and use Stream.interruptWhen for user-initiated cancellation"
  - "Timeout-aware retry: check error.name for ToolTimeoutError and use separate backoff parameters"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-03-09
---

# Phase 54 Plan 02: Longer Retry Delay for Tool Timeouts and Stream Abort on Explicit Exit

**Tool timeout retries use 15s base backoff instead of 1s, and explicit user exit (/exit, Ctrl+C) aborts the active stream via AbortSignal**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-09T05:13:14Z
- **Completed:** 2026-03-09T05:21:00Z
- **Tasks:** 8
- **Files modified:** 7

## Accomplishments
- Tool timeout errors now use a 15s base backoff delay (configurable via `timeoutBackoffMs`) instead of the default 1s, letting upstream services recover before retry
- User-initiated exit (/exit, Ctrl+C) aborts the active Effect stream via `Stream.interruptWhen` with an AbortSignal, preventing orphan processing
- Aborted streams suppress error display in the TUI catch handler
- Full test suite (1828 tests) passes with no regressions

## Task Commits

Each task was committed atomically:

1. **Tasks 1-3: Timeout-specific backoff and tests** - `8c382ba` (feat)
2. **Tasks 4-7: Stream abort on explicit exit** - `fd24228` (feat)
3. **Task 8: AbortSignal stream interruption tests** - `5a939b1` (test)

## Files Created/Modified
- `packages/core/src/agent/agent.ts` - Added `timeoutBackoffMs` to `ToolRetryPolicy`
- `packages/core/src/agent/factory.ts` - `computeBackoff` uses higher base/max for timeout errors; retry loop passes `isTimeout` flag
- `packages/core/src/message-processor/types.ts` - Added `signal?: AbortSignal` to `ProcessingOptions`
- `packages/core/src/index.ts` - `streamMessage()` wraps stream with `Stream.interruptWhen` when signal provided
- `packages/cli/src/commands/chat.ts` - AbortController per streaming session; onQuit aborts; catch suppresses abort errors
- `tests/unit/core/agent/factory.test.ts` - Tests for timeout backoff policy acceptance and config wiring
- `tests/unit/core/stream/abort-signal.test.ts` - Tests for AbortSignal stream interruption patterns

## Decisions Made
- Timeout backoff uses 15s default base delay with 30s max cap, separate from normal 1s/10s backoff. This gives slow APIs and rate-limited endpoints time to recover.
- AbortSignal is threaded through `ProcessingOptions` and converted to Effect Stream interruption via `Stream.interruptWhen(Effect.async(...))` pattern.
- `onQuit` handler aborts active stream controller before calling `process.exit(0)`, ensuring cleanup.
- Aborted stream catch blocks silently return instead of calling `app.failAssistantStream(error)`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both plans in Phase 54 are complete
- Timeout retry backoff and stream abort are independent features that compose cleanly
- Full test and build verification green

---
*Phase: 54-cancellation-propagation*
*Completed: 2026-03-09*
