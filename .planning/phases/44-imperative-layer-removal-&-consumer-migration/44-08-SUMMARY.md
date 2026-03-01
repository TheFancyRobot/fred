---
phase: 44-imperative-layer-removal-&-consumer-migration
plan: 08
subsystem: testing
tags: [agent-factory, toolregistrylike, test-migration, gap-closure]

# Dependency graph
requires:
  - phase: 44-03
    provides: AgentFactory now depends on structural ToolRegistryLike contracts instead of ToolRegistry class coupling
  - phase: 44-05
    provides: Deleted imperative ToolRegistry class that these tests previously imported
provides:
  - Shared ToolRegistryLike mock helper for agent-related tests
  - Four agent factory test suites migrated off deleted ToolRegistry imports
  - Verified zero tool/registry imports in tests/unit/core/agent after migration
affects: [44-09 test migration, phase-45 full test-suite stabilization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Test suites instantiate AgentFactory with structural ToolRegistryLike mocks via shared helper
    - Tool registry mock state is map-backed and supports register/get/has/missing operations used by agent tests

key-files:
  created:
    - tests/unit/helpers/mock-tool-registry.ts
    - .planning/phases/44-imperative-layer-removal-&-consumer-migration/44-08-SUMMARY.md
  modified:
    - tests/unit/core/agent/factory.test.ts
    - tests/unit/core/agent/factory-streaming.test.ts
    - tests/unit/core/agent/mcp-factory.test.ts
    - tests/unit/core/agent/retry.test.ts

key-decisions:
  - "Use a single shared createMockToolRegistry helper under tests/unit/helpers to keep ToolRegistryLike behavior consistent across agent tests"
  - "Migrate mcp-factory assertions to getTools-based lookup so tests only rely on ToolRegistryLike surface"

patterns-established:
  - "Post-deletion test migrations should prefer structural capability mocks over deleted class imports"
  - "Cross-suite helper reuse reduces drift while keeping test doubles local to tests/unit/helpers"

requirements-completed: [RMVL-01, RMVL-08]

# Metrics
duration: 1 min
completed: 2026-03-01
---

# Phase 44 Plan 08: Agent Factory ToolRegistryLike Test Migration Summary

**Agent factory tests now use a shared structural ToolRegistryLike mock helper, removing deleted ToolRegistry imports while keeping factory, streaming, MCP, and retry coverage green.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-01T18:05:53Z
- **Completed:** 2026-03-01T18:07:13Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments
- Added `createMockToolRegistry()` helper with map-backed register/get/has/missing behavior required by `AgentFactory` tests.
- Migrated `factory.test.ts`, `factory-streaming.test.ts`, `mcp-factory.test.ts`, and `retry.test.ts` to use structural mocks instead of `new ToolRegistry()`.
- Replaced MCP test direct `getTool` dependency with `getTools([...])[0]` to align assertions with ToolRegistryLike interface methods.
- Verified targeted agent factory suites pass and `tests/unit/core/agent/` has zero `tool/registry` imports.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared ToolRegistryLike mock helper and migrate agent factory tests** - `4397f88` (test)

**Plan metadata:** pending

## Files Created/Modified
- `tests/unit/helpers/mock-tool-registry.ts` - shared in-memory structural mock implementing the ToolRegistryLike contract used by AgentFactory.
- `tests/unit/core/agent/factory.test.ts` - swapped deleted ToolRegistry import/instantiation for shared structural mock.
- `tests/unit/core/agent/factory-streaming.test.ts` - migrated streaming integration tests to shared structural tool registry mock.
- `tests/unit/core/agent/mcp-factory.test.ts` - migrated to structural mock and updated lookup assertion to `getTools`.
- `tests/unit/core/agent/retry.test.ts` - migrated retry-focused factory tests to structural registry mock.

## Decisions Made
- Standardized ToolRegistryLike mocking through one helper to avoid per-file drift during remaining Phase 44/45 test migrations.
- Kept mock behavior limited to constructor contract methods (`registerTool`, `getTools`, `hasTool`, `getMissingToolIds`) rather than reintroducing deleted class APIs.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Agent factory test imports are now aligned with structural ToolRegistryLike seams introduced by the imperative-layer removal.
- Remaining gap-closure work can continue with `44-07-PLAN.md` and `44-09-PLAN.md` to finish stale test import cleanup.

---
*Phase: 44-imperative-layer-removal-&-consumer-migration*
*Completed: 2026-03-01*
