---
phase: 46-showcase-examples
plan: 04
subsystem: examples
tags: [examples, handoff, pipelinebuilder, checkpointing, resume]

requires:
  - phase: 46-02
    provides: Fred pipeline V2 registration support, graph workflow facade methods, and handoff helper export
provides:
  - Self-contained Example 04 for tool-based bidirectional agent handoff
  - Self-contained Example 05 for sequential V2 pipelines with pause/resume checkpoint flow
  - README guidance comparing handoff patterns and documenting checkpoint/restart behavior
affects: [46-05, 46-08, examples]

tech-stack:
  added: []
  patterns: [self-contained example packaging, runtime service access for V2 pipeline execution]

key-files:
  created:
    - examples/04-dynamic-handoff/package.json
    - examples/04-dynamic-handoff/README.md
    - examples/04-dynamic-handoff/.env.example
    - examples/04-dynamic-handoff/tsconfig.json
    - examples/04-dynamic-handoff/src/index.ts
    - examples/05-pipeline-sequential/package.json
    - examples/05-pipeline-sequential/README.md
    - examples/05-pipeline-sequential/.env.example
    - examples/05-pipeline-sequential/tsconfig.json
    - examples/05-pipeline-sequential/src/index.ts
  modified:
    - examples/04-dynamic-handoff/src/index.ts

key-decisions:
  - "Example 04 uses the exported createHandoffTool(getAgent, getAvailableAgents) API with one shared handoff tool across intake and specialists"
  - "Example 05 executes step-based pipelines through PipelineService.executePipelineV2 via Fred runtime to demonstrate checkpoint pause/resume behavior end-to-end"

patterns-established:
  - "Example handoff docs explicitly position tool-driven handoff versus intent re-routing"
  - "Checkpointing demos include out-of-the-box in-process resume plus guidance for persistent crash/restart recovery"

duration: 4 min
completed: 2026-03-02
---

# Phase 46 Plan 04: Examples 04-05 Summary

**Dynamic handoff and sequential checkpointed pipeline examples now demonstrate multi-agent transfer and pause/resume orchestration as core Fred differentiators.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T23:41:24Z
- **Completed:** 2026-03-02T23:46:15Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Added Example 04 (`04-dynamic-handoff`) with intake and specialist agents using `createHandoffTool`, including bidirectional handoff behavior and shared conversation context.
- Added Example 05 (`05-pipeline-sequential`) with `PipelineBuilder`, mixed agent/function steps, explicit pause-for-human-input, and resume flow.
- Wrote companion READMEs and environment/setup templates for both examples, including architecture/flow explanation and positioning against Example 03 routing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Example 04 - Dynamic Handoff** - `769ec6b` (feat)
2. **Task 2: Create Example 05 - Pipeline Sequential with Checkpointing** - `5ddc1ba` (feat)

## Files Created/Modified
- `examples/04-dynamic-handoff/package.json` - Workspace-scoped example package and start script.
- `examples/04-dynamic-handoff/README.md` - Handoff walkthrough, pattern comparison, and flow diagram.
- `examples/04-dynamic-handoff/.env.example` - OpenAI key template.
- `examples/04-dynamic-handoff/tsconfig.json` - Example typecheck config.
- `examples/04-dynamic-handoff/src/index.ts` - Intake/specialist handoff demo with `createHandoffTool`.
- `examples/05-pipeline-sequential/package.json` - Workspace-scoped example package and start script.
- `examples/05-pipeline-sequential/README.md` - Sequential pipeline and checkpoint/resume explanation.
- `examples/05-pipeline-sequential/.env.example` - OpenAI key template.
- `examples/05-pipeline-sequential/tsconfig.json` - Example typecheck config.
- `examples/05-pipeline-sequential/src/index.ts` - `PipelineBuilder` sequential flow with pause and `fred.resume(...)`.

## Decisions Made
- Used the actual exported handoff helper signature (`createHandoffTool(getAgent, getAvailableAgents)`) and enabled it for all handoff-capable agents through `tools: ['handoff_to_agent']`.
- Used runtime `PipelineService.executePipelineV2(...)` for executing step-based pipelines so checkpoint pause/resume can be demonstrated without relying on V1-only `fred.executePipeline(...)` behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Running `bunx tsc --noEmit -p examples/04-dynamic-handoff/tsconfig.json` surfaces extensive pre-existing workspace TypeScript/Effect diagnostics outside this plan's scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `46-05-PLAN.md` (examples 06-07). The handoff and sequential checkpointing showcase artifacts are in place and aligned with phase context goals.

---
*Phase: 46-showcase-examples*
*Completed: 2026-03-02*
