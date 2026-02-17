---
phase: 32-plugin-architecture
plan: 03
subsystem: cli/plugins
tags:
  - plugin-commands
  - cli-dispatch
  - help-rendering
  - conflict-policy
dependency-graph:
  requires:
    - phase: 32-plugin-architecture
      provides: plugin discovery/validation manager and staged plugin contributions from 32-02
  provides:
    - plugin-cli-runtime-dispatch
    - conflict-safe-top-level-command-registration
    - plugin-help-section-with-unavailable-stubs
    - plugin-command-execution-tests
  affects:
    - plugin-slash-command-integration
    - plugin-cli-user-documentation
    - startup-error-surface-behavior
tech-stack:
  added: []
  patterns:
    - builtins-win-top-level-plugin-command-conflicts
    - dual-plugin-command-exposure-top-level-and-namespaced
    - plugin-attributed-runtime-error-prefixing
key-files:
  created:
    - packages/cli/src/plugin/runtime.ts
    - packages/cli/src/plugin/help.ts
    - packages/cli/tests/plugin/cli-plugin-commands.test.ts
  modified:
    - packages/cli/src/index.ts
    - packages/cli/src/plugin/registry.ts
decisions:
  - decision: route only unknown commands into plugin runtime after built-in switch dispatch
    rationale: preserves existing CLI behavior and guarantees core commands always override plugin collisions
    alternatives:
      - pre-dispatch plugin lookup before built-in switch
    impact: conflict policy is enforced both at registration and at execution time
  - decision: include unavailable top-level plugin stubs in help while still exposing namespaced invocation
    rationale: users need discoverability for blocked registrations without losing safe invocation paths
    alternatives:
      - hide conflicted commands completely
    impact: help output communicates conflict causes and recovery path clearly
metrics:
  duration: 4 min
  tasks-completed: 2
  tests-added: 4
  tests-passing: 4
  completed-date: 2026-02-14
---

# Phase 32 Plan 03: Plugin CLI Dispatch and Help Summary

**Shipped a plugin CLI runtime that dispatches plugin commands via top-level and namespaced forms, enforces built-in conflict precedence, and renders plugin command availability in `fred help`.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T20:15:41Z
- **Completed:** 2026-02-14T20:20:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `createPluginCliRuntime` to register plugin command contributions, enforce built-in conflict policy, and dispatch unknown commands through plugin handlers.
- Integrated plugin startup loading into CLI entrypoint dispatch flow so unknown built-in commands now route through plugin runtime while preserving existing built-in handling.
- Added plugin help section rendering and test coverage for successful execution, conflict stubs, dual exposure (`command` + `plugin:command`), and plugin-attributed runtime errors.

## Task Commits

1. **Task 1: Add plugin CLI runtime registration and conflict-safe dispatch** - `fa7a331` (feat)
2. **Task 2: Render plugin command help sections with unavailable stubs and add tests** - `5b867cf` (test)

## Files Created/Modified

- `packages/cli/src/plugin/runtime.ts` - Implements plugin command registration, conflict checks, dispatch, and plugin-attributed runtime error handling.
- `packages/cli/src/plugin/help.ts` - Renders a dedicated plugin command help section with unavailable stub reasons and namespaced invocation labels.
- `packages/cli/src/plugin/registry.ts` - Adds command flattening helper used by runtime registration.
- `packages/cli/src/index.ts` - Loads plugin runtime at startup, dispatches unknown commands to plugin runtime, and injects plugin help section into `fred help`.
- `packages/cli/tests/plugin/cli-plugin-commands.test.ts` - Verifies registration, conflict behavior, dual exposure, help rendering, and runtime error attribution.

## Decisions Made

- Kept built-in commands authoritative by routing plugin dispatch only from default unknown-command handling.
- Exposed conflicted top-level plugin commands as unavailable stubs in help while preserving namespaced execution.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CLI plugin command surfaces are now available for alignment with plugin slash-command UX and shared command metadata in 32-04.
- No blockers introduced by this plan.

---
*Phase: 32-plugin-architecture*
*Completed: 2026-02-14*
