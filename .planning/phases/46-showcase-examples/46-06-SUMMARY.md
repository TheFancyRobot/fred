---
phase: 46-showcase-examples
plan: 06
subsystem: examples
tags: [examples, observability, tracing, eval, golden-traces]
requires:
  - phase: 46-01
    provides: Example workspace scaffold and structure guard baseline
  - phase: 46-02
    provides: Public API prerequisites and re-exports used by new examples
provides:
  - Example 08 for hook-based tracing with optional OTEL wiring guidance
  - Example 09 for golden-trace evaluation using assertion DSL and CI test flow
affects: [46-08 examples final verification, examples documentation]
tech-stack:
  added: []
  patterns: [self-contained example packaging, golden-trace regression checks]
key-files:
  created:
    - examples/08-observability-tracing/package.json
    - examples/08-observability-tracing/README.md
    - examples/08-observability-tracing/.env.example
    - examples/08-observability-tracing/tsconfig.json
    - examples/08-observability-tracing/src/index.ts
    - examples/09-evaluation-harness-golden-traces/package.json
    - examples/09-evaluation-harness-golden-traces/README.md
    - examples/09-evaluation-harness-golden-traces/.env.example
    - examples/09-evaluation-harness-golden-traces/tsconfig.json
    - examples/09-evaluation-harness-golden-traces/src/index.ts
    - examples/09-evaluation-harness-golden-traces/test/eval.test.ts
    - examples/09-evaluation-harness-golden-traces/test/golden-traces/sample.golden.json
  modified: []
key-decisions:
  - "Example 09 uses the actual eval API contract (`traceFile` + `tracesDirectory`) instead of the sketch API shown in the plan."
  - "Example 08 centers observability on hook events, with OTEL presented as an optional production path."
patterns-established:
  - "Examples should use robust local path resolution with import.meta.url for test artifacts."
  - "Golden traces should include routing, tool calls, response content, and spans to support full assertion coverage."
duration: 3 min
completed: 2026-03-02
---

# Phase 46 Plan 06: Observability and Golden-Trace Showcase Summary

**Hook-based tracing and golden-trace assertion workflows are now represented as self-contained examples with runnable code, tests, and competitive positioning guidance.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T23:41:31Z
- **Completed:** 2026-03-02T23:45:12Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Added Example 08 (`08-observability-tracing`) with structured hook event capture for message receipt, routing, tool usage, and response generation.
- Added Example 09 (`09-evaluation-harness-golden-traces`) with golden trace loading, assertion DSL test-case execution, formatted output, and CI-friendly `bun:test` coverage.
- Included documentation for optional OpenTelemetry layer wiring in Example 08 and explicit framework differentiation language in Example 09.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Example 08 - Observability and Tracing** - `40282aa` (feat)
2. **Task 2: Create Example 09 - Evaluation Harness with Golden Traces** - `d6ecda0` (feat)

**Plan metadata:** pending metadata commit

## Files Created/Modified

- `examples/08-observability-tracing/package.json` - Example package with start script and workspace dependencies
- `examples/08-observability-tracing/README.md` - Lightweight vs OTEL observability guide and run instructions
- `examples/08-observability-tracing/.env.example` - API key setup template
- `examples/08-observability-tracing/tsconfig.json` - Per-example TypeScript config
- `examples/08-observability-tracing/src/index.ts` - Hook-based tracing demo with structured trace log output
- `examples/09-evaluation-harness-golden-traces/package.json` - Example package with start/test scripts
- `examples/09-evaluation-harness-golden-traces/README.md` - Golden-trace eval walkthrough and differentiation notes
- `examples/09-evaluation-harness-golden-traces/.env.example` - API key template for trace recording scenarios
- `examples/09-evaluation-harness-golden-traces/tsconfig.json` - TypeScript config including `src` and `test`
- `examples/09-evaluation-harness-golden-traces/src/index.ts` - Demo runner using `runTestCases` and formatted results
- `examples/09-evaluation-harness-golden-traces/test/eval.test.ts` - CI-oriented bun test for routing/response assertions
- `examples/09-evaluation-harness-golden-traces/test/golden-traces/sample.golden.json` - Valid sample golden trace with spans and tool call artifacts

## Decisions Made

- Used actual `@fancyrobot/fred/eval` assertion runner signatures (`traceFile` on test cases plus shared traces directory input) to avoid API drift from the sketch in the plan text.
- Kept OTEL integration guidance optional and commented in Example 08 to keep the runnable path simple while still demonstrating production telemetry upgrade paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed unsupported `bun-types` type reference from example tsconfig**

- **Found during:** Task 1 verification
- **Issue:** `bunx tsc -p examples/08-observability-tracing/tsconfig.json` failed with `Cannot find type definition file for 'bun-types'`
- **Fix:** Removed the explicit `types: ["bun-types"]` entry from the example tsconfig
- **Files modified:** examples/08-observability-tracing/tsconfig.json
- **Verification:** Required file-presence verification for Task 1 passed and example configuration no longer references a missing type package
- **Committed in:** `40282aa` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was required to keep the example template self-consistent. No scope creep.

## Issues Encountered

- Running standalone `tsc` for example configs surfaces pre-existing repository-wide TypeScript errors unrelated to this plan's scope. Plan-required automated checks were completed via task-specific file checks and example eval test execution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for remaining showcase-example plans and final guard/README consolidation.
- No blockers introduced by this plan.

---

*Phase: 46-showcase-examples*
*Completed: 2026-03-02*
