# Phase 45: Public API Surface & Verification - Research

**Researched:** 2026-03-01
**Domain:** TypeScript module exports, Effect service composition, breaking change documentation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Main export (`@fancyrobot/fred`) includes Effect service tags, commonly-used types, and utility functions -- removes only imperative classes
- Fred class AND Effect runtime creation (`createFredRuntime`, `FredLayers`) both exported -- transition period where consumers can use either
- Eval/test framework exports (GoldenTraceRecorder, TestCase, assertions, etc.) move to `@fancyrobot/fred/eval` sub-path; update CLI test.ts imports accordingly
- Storage implementations (SqliteContextStorage, PostgresContextStorage, CheckpointStorage) move to sub-paths (e.g., `@fancyrobot/fred/context/sqlite`); update consumer imports
- Observability export organization: research implementation patterns in other Effect-based libraries and use that research as guidance for where observability exports live
- Package.json `"exports"` field must be added/updated to explicitly control which paths consumers can import -- prevent accidental deep imports into internals
- Built-in tools (createCalculatorTool) move to sub-path within `@fancyrobot/fred/tools` as intermediate step
- CHANGELOG uses changesets format with before/after code examples showing migration paths
- Version: 0.3.0
- Covers the entire v0.3.0 milestone (phases 41-45) as one cohesive breaking change release
- Audience: external consumers -- docs must be clear for someone unfamiliar with the migration context
- Changesets for all affected packages: @fred/core (breaking), @fred/cli, @fred/dev (patch/minor for import path updates)
- No "why this change" motivation section -- just the facts: what changed, what replaces it, code examples
- Clean break: remove imperative exports entirely, no deprecation shims
- Phase 44 must be verified complete before Phase 45 starts -- no straggler consumer imports of imperative classes
- Block removal of any imperative class that has NO Effect service equivalent -- every removal must have a migration path
- WorkflowManager MUST have an Effect service equivalent; if not already implemented, create it in this phase
- Audit type-only exports: keep only types that consumers actually use or that map to Effect service APIs; remove orphaned types tied to imperative classes
- Fix ALL pre-existing LSP errors: Effect yield errors in index.ts, tracing import errors, config/initializer reference -- no known issues left
- Fix and verify: Phase 45 actively fixes any broken tests caused by the migration, not just verifies they pass
- Verify build output: `bun run build` succeeds AND verify dist output has correct exports with a smoke test importing from the built package
- Verify boundary guard test: confirm `phase-44-boundary-guard.test.ts` passes with no new Effect.runPromise violations
- Phase 45 handles interface tweaks needed to fix LSP errors -- even if they touch service interfaces
- Remove ALL @ts-ignore and @ts-expect-error workaround annotations added during the migration; fix underlying type issues

### Claude's Discretion
- Provider pack export location (main vs sub-path) -- determine based on consumer usage patterns
- Build scope (all packages vs core + consumers) -- determine based on dependency graph
- Exact sub-path naming conventions for moved exports

### Deferred Ideas (OUT OF SCOPE)
- `@fancyrobot/fred-tools` package: Dedicated package for built-in tools (calculator, etc.) as Effect-based tools -- future phase
- Motivation/architecture documentation: A blog post or README section explaining the why behind the Effect migration -- not CHANGELOG content
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | `exports.ts` no longer exports ToolRegistry, AgentManager, ContextManager, HookManager, or MessageRouter imperative classes | Already satisfied -- Phase 44 deleted all imperative manager files; `exports.ts` has zero imperative class exports. Verified via grep. Remaining work: audit `IntentMatcher`/`IntentRouter` class exports and `WorkflowManager` class. |
| API-02 | `exports.ts` exports Effect service tags for consumer dependency injection | Partially done -- `index.ts` re-exports 8 service tags from `services.ts`. Missing from public re-exports: `IntentMatcherService`, `IntentRouterService`, `MessageRouterService`, `ObservabilityService`, `ToolGateService`, `PauseService`, `CheckpointService`. Need to add these. |
| API-03 | `services.ts` Layer composition provides all services through a single composable Layer | Already implemented -- `FredLayers`, `FredLayersWithIntentRouting`, `makeFredLayersWithLeafRouting`, `makeFredRuntimeLayer` all exist with wave-based dependency ordering. |
| API-04 | Breaking changes documented in CHANGELOG | Not started -- need changeset for v0.3.0 covering phases 41-45 as cohesive breaking change release. |
| TEST-01 | All existing unit tests pass after migration | Currently green -- 1625 tests pass, 0 failures across 109 files. |
| TEST-02 | `bun run build` succeeds with zero TypeScript errors | Currently green -- all packages build successfully with zero errors. |
| TEST-03 | `bun test` passes with no regressions | Currently green -- same as TEST-01. |
| TEST-04 | Pre-existing LSP errors resolved or documented | Requires investigation -- need to run `bunx tsc --noEmit` to check for type errors beyond build. Research found zero `@ts-ignore`/`@ts-expect-error` annotations in core/src. |
</phase_requirements>

## Summary

Phase 45 is the verification and cleanup gate for the v0.3.0 Effect migration. The heavy lifting is done: all 8 imperative manager classes are deleted (Phase 44), all Effect services are standalone (Phases 41-42), the Fred facade delegates through runtime services (Phase 43), and all 1625 tests pass with zero build errors.

The remaining work falls into four categories: (1) **Export surface cleanup** -- reorganize `exports.ts` and `package.json` exports to remove remaining non-Effect classes (`IntentMatcher`, `IntentRouter`, `WorkflowManager`) and move domain-specific exports to sub-paths (`/eval`, `/context/sqlite`, `/tools`); (2) **WorkflowManager Effect service** -- create `WorkflowService` since `WorkflowManager` is the last imperative class with no Effect equivalent; (3) **Breaking change documentation** -- create changesets for v0.3.0 with before/after migration examples; (4) **Verification sweep** -- typecheck, build smoke test, boundary guard confirmation, and LSP error resolution.

**Primary recommendation:** Work in dependency order: create WorkflowService first (unblocks export cleanup), then reorganize exports + package.json, then write changesets, then run full verification suite.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect | ^3.19.x | Effect system for services, layers, errors | Already the project's core dependency |
| @changesets/cli | ^2.29.8 | Changeset creation and versioning | Already configured in monorepo with GitHub changelog |
| Bun | runtime | Build, test, package resolution | Project runtime |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @changesets/changelog-github | ^0.5.2 | GitHub-linked changelogs | Already configured -- generates PR/commit links |

### Alternatives Considered
None -- this phase uses only existing project tooling.

## Architecture Patterns

### Current Export Architecture
```
packages/core/src/
├── index.ts            # Fred class + re-exports from exports.ts + services
├── exports.ts          # Public API surface (types, classes, utilities)
├── services.ts         # Effect service tags, layers, runtime utilities
└── effect/index.ts     # Power-user Effect API (unused by consumers currently)
```

### Target Export Architecture (Sub-Path Organization)
```
@fancyrobot/fred            # Fred class, Effect service tags, core types, utilities
@fancyrobot/fred/eval       # Evaluation framework (GoldenTraceRecorder, assertions, suite, etc.)
@fancyrobot/fred/context/sqlite   # SqliteContextStorage
@fancyrobot/fred/context/postgres # PostgresContextStorage
@fancyrobot/fred/tools      # Built-in tools (createCalculatorTool)
@fancyrobot/fred/effect     # Power-user Effect API (existing)
```

### Pattern 1: Package.json Exports Field
**What:** The `"exports"` field in `package.json` controls which paths consumers can import from.
**When to use:** When reorganizing public API to prevent deep imports into internals.
**Current state:** Only `.` and `./effect` are defined. Need to add sub-paths.
**Example:**
```json
{
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./eval": {
      "types": "./src/eval/index.ts",
      "import": "./src/eval/index.ts",
      "default": "./src/eval/index.ts"
    },
    "./context/sqlite": {
      "types": "./src/context/storage/sqlite.ts",
      "import": "./src/context/storage/sqlite.ts",
      "default": "./src/context/storage/sqlite.ts"
    },
    "./context/postgres": {
      "types": "./src/context/storage/postgres.ts",
      "import": "./src/context/storage/postgres.ts",
      "default": "./src/context/storage/postgres.ts"
    },
    "./tools": {
      "types": "./src/tool/calculator.ts",
      "import": "./src/tool/calculator.ts",
      "default": "./src/tool/calculator.ts"
    },
    "./effect": {
      "types": "./src/effect/index.ts",
      "import": "./src/effect/index.ts",
      "default": "./src/effect/index.ts"
    }
  }
}
```

### Pattern 2: WorkflowService Effect Service
**What:** Convert `WorkflowManager` (imperative class with `Fred` dependency) into an Effect service using `Context.Tag` + `Ref`.
**When to use:** Required by CONTEXT.md locked decision.
**Scope:** WorkflowManager is small (82 lines, 4 public methods). The service needs `AgentService` as a dependency for validation (replaces `fred.getAgent()`).
**Example:**
```typescript
import { Context, Effect, Layer, Ref } from 'effect';
import type { Workflow } from './manager';
import { AgentService } from '../agent/service';

export interface WorkflowService {
  addWorkflow(name: string, config: Omit<Workflow, 'name'>): Effect.Effect<void>;
  getWorkflow(name: string): Effect.Effect<Workflow | undefined>;
  listWorkflows(): Effect.Effect<string[]>;
  hasWorkflow(name: string): Effect.Effect<boolean>;
}

export const WorkflowService = Context.GenericTag<WorkflowService>('WorkflowService');

export const WorkflowServiceLive = Layer.effect(
  WorkflowService,
  Effect.gen(function* () {
    const workflows = yield* Ref.make(new Map<string, Workflow>());
    const agentService = yield* AgentService;
    // ... implementation
  })
);
```

### Pattern 3: Changeset Format for Breaking Changes
**What:** Changesets use markdown frontmatter to specify package + bump level, with body as changelog entry.
**When to use:** For the v0.3.0 release changeset.
**Example (from existing project changeset):**
```markdown
---
"@fancyrobot/fred": major
"@fancyrobot/fred-cli": minor
"@fancyrobot/fred-dev": patch
---

## Breaking Changes

### Removed imperative manager classes

The following classes have been removed. Use Effect services instead:

**Before (v0.2.x):**
```typescript
import { ToolRegistry, AgentManager } from '@fancyrobot/fred';
const registry = new ToolRegistry();
```

**After (v0.3.0):**
```typescript
import { ToolRegistryService, AgentService } from '@fancyrobot/fred';
import { Effect } from 'effect';
const tools = Effect.gen(function* () {
  const registry = yield* ToolRegistryService;
  return yield* registry.getAllTools();
});
```
```

### Anti-Patterns to Avoid
- **Barrel export bloat:** Don't re-export every internal type from the main entrypoint. Only export what consumers actually need.
- **Breaking existing deep imports:** The CLI currently imports from `@fancyrobot/fred/mcp/types` and `@fancyrobot/fred/mcp/registry` and `@fancyrobot/fred/tool/tool`. These deep imports are NOT in the current `exports` field but work because Bun resolves workspace packages directly. Adding an `exports` field with explicit paths may break these unless they are also listed or a wildcard is used.
- **Over-constraining exports:** Adding `"exports"` to `package.json` makes unlisted paths inaccessible. Must enumerate ALL paths consumers currently use, including deep imports from CLI tests.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Changeset creation | Manual CHANGELOG editing | `@changesets/cli` (`bun changeset`) | Already configured; auto-generates GitHub PR links |
| Export validation | Custom import tests | Bun module resolution + explicit `package.json` exports | Standard Node/Bun resolution handles this |
| Type checking | Manual LSP error scanning | `bunx tsc --noEmit` | Catches all type errors systematically |

**Key insight:** The changeset tooling is already configured with GitHub changelog integration. Write the changeset markdown file directly in `.changeset/` directory -- no special tooling needed beyond creating the file.

## Common Pitfalls

### Pitfall 1: Breaking Deep Imports with Exports Field
**What goes wrong:** Adding `"exports"` to `package.json` makes all unlisted paths inaccessible. Consumers using deep imports (e.g., `@fancyrobot/fred/mcp/types`) will get module-not-found errors.
**Why it happens:** The `exports` field acts as a strict allowlist in Node.js ESM resolution. Any path not explicitly listed is blocked.
**How to avoid:** Inventory ALL current deep imports before adding the exports field. Currently found:
- `@fancyrobot/fred/mcp/types` (CLI tests)
- `@fancyrobot/fred/mcp/registry` (CLI commands)
- `@fancyrobot/fred/tool/tool` (CLI tests)
These must either be (a) added to the exports field, (b) migrated to main entrypoint imports, or (c) the exports field must include a catch-all pattern.
**Warning signs:** Module-not-found errors after changing `package.json`.
**Note:** Bun workspace resolution may bypass `exports` field restrictions for workspace packages. Test with actual `bun test` after changes.

### Pitfall 2: WorkflowManager Has Fred Circular Dependency
**What goes wrong:** `WorkflowManager` imports `Fred` from `../index` for its `fred.getAgent()` validation calls. Converting to Effect service must break this circular dependency.
**Why it happens:** The imperative class was tightly coupled to the Fred facade.
**How to avoid:** Use `AgentService` dependency injection (already available in the Effect service layer) instead of the Fred class reference.
**Warning signs:** Import cycles causing undefined values at module load time.

### Pitfall 3: Eval Sub-Path Barrel Needs Complete Export Coverage
**What goes wrong:** Moving eval exports to `@fancyrobot/fred/eval` requires a barrel file that exports everything CLI `eval.ts` and `test.ts` currently import from `@fancyrobot/fred`.
**Why it happens:** The CLI imports eval types mixed with non-eval types (e.g., `Fred`, `ObservabilityServiceLive`) from the main entrypoint.
**How to avoid:** Audit exact imports in `packages/cli/src/eval.ts` and `packages/cli/src/test.ts`. Only move eval-specific exports to the sub-path; keep `Fred` and generic services on the main path. CLI files will need split imports: `from '@fancyrobot/fred'` for Fred class + `from '@fancyrobot/fred/eval'` for eval types.
**Current CLI eval.ts imports from `@fancyrobot/fred`:**
```typescript
import {
  EvaluationRunNotFoundError,   // eval
  EvaluationService,            // eval
  EvaluationServiceLive,        // eval
  FileTraceStorageLive,         // eval
  Fred,                         // stays on main
  ObservabilityServiceLive,     // stays on main
  TraceStorageService,          // eval
  compare,                      // eval
  createReplayOrchestrator,     // eval
  evaluation,                   // eval namespace
  type EvaluationArtifact,      // eval
  type GoldenTrace,             // eval
  type ReplayRuntimeAdapter,    // eval
  type SuiteCaseExecutionResult,// eval
  type SuiteManifest,           // eval
  validateEvaluationArtifact,   // eval
} from '@fancyrobot/fred';
```
**Current CLI test.ts imports:**
```typescript
import { Fred } from '@fancyrobot/fred';                           // stays on main
import { NoOpTracer, GoldenTraceRecorder, loadGoldenTrace,
         runTestCase, formatTestResults, TestCase } from '@fancyrobot/fred';  // eval sub-path
```

### Pitfall 4: Forgetting to Update Effect Sub-Path Barrel
**What goes wrong:** The `@fancyrobot/fred/effect` sub-path re-exports from `./services`, `./errors`, `./layers`. If service tags are added (WorkflowService) or removed, this barrel must also be updated.
**Why it happens:** Multiple barrel files duplicating export lists.
**How to avoid:** After any service tag change, verify the `effect/` barrel exports match.

### Pitfall 5: Changeset Must Be `major` for @fancyrobot/fred
**What goes wrong:** Using `minor` or `patch` for a breaking change release.
**Why it happens:** Changesets default to patch.
**How to avoid:** The changeset frontmatter must use `"@fancyrobot/fred": major` to bump to 0.3.0. Note: under semver 0.x, both minor and major can indicate breaking changes, but the CONTEXT says version 0.3.0 and `major` in changesets format means the minor version bumps for 0.x packages.

## Code Examples

### Current `exports.ts` Remaining Non-Effect Classes (to audit/remove/move)
```typescript
// These are still exported as classes from exports.ts:
export { IntentMatcher } from './intent/matcher';    // class -- has IntentMatcherService equivalent
export { IntentRouter } from './intent/router';      // class -- has IntentRouterService equivalent
export { WorkflowManager } from './workflow/manager'; // class -- needs WorkflowService created
export { SqliteContextStorage } from './context/storage/sqlite';    // class -- move to sub-path
export { PostgresContextStorage } from './context/storage/postgres'; // class -- move to sub-path
export { createCalculatorTool } from './tool/calculator';           // function -- move to sub-path

// Checkpoint classes still exported:
export { PostgresCheckpointStorage, SqliteCheckpointStorage,
         CheckpointManager, CheckpointCleanupTask } from './pipeline/checkpoint';
```

### Service Tags Currently Re-Exported from index.ts
```typescript
// From index.ts line ~1386:
export {
  FredLayers,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  MessageProcessorServiceLive,
} from './services';
```

### Service Tags Available in services.ts but NOT Re-Exported from index.ts
```typescript
// These exist in services.ts but are missing from the main entrypoint:
ToolGateService, ToolGateServiceLive,
CheckpointService, CheckpointServiceLive,
PauseService, PauseServiceLive,
IntentMatcherService, IntentMatcherServiceLive,
IntentRouterService, IntentRouterServiceLive,
MessageRouterService, MessageRouterServiceLiveWithConfig,
ObservabilityService, ObservabilityServiceLive,
```

### Consumer Import Locations (must all work after changes)
```
@fancyrobot/fred (main):
  - packages/cli/src/commands/chat.ts: Fred, SqliteContextStorage
  - packages/cli/src/commands/run.ts: Fred, hasRetryDiagnostics
  - packages/cli/src/eval.ts: Fred, ObservabilityServiceLive, EvaluationService, etc.
  - packages/cli/src/test.ts: Fred, NoOpTracer, GoldenTraceRecorder, etc.
  - packages/dev/src/dev-chat.ts: Fred, WorkflowManager, getBuiltinPackIds
  - packages/dev/src/server/chat/handlers.ts: Fred, toOpenAIStream
  - Provider packages: registerBuiltinPack, EffectProviderFactory, etc.

Deep imports (not in exports field):
  - packages/cli/tests/commands/mcp.test.ts: @fancyrobot/fred/mcp/types
  - packages/cli/tests/commands/mcp.test.ts: @fancyrobot/fred/tool/tool
  - packages/cli/src/commands/mcp.ts: @fancyrobot/fred/mcp/registry
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Imperative manager classes (ToolRegistry, AgentManager, etc.) | Effect service tags (ToolRegistryService, AgentService, etc.) | Phases 41-44 | All 8 managers deleted; services are standalone |
| `new Fred()` constructor only | `Fred.create()` async factory preferred | Phase 43 | Lazy runtime init for backward compat |
| Promise-based API only | Fred facade (Promise) + Effect services (direct) | Phase 43 | Both coexist; Effect is internal default |
| No package.json exports field | Need explicit exports field | Phase 45 (this phase) | Prevents deep import to internals |

**Deprecated/outdated (to remove in this phase):**
- `IntentMatcher` class export -- replaced by `IntentMatcherService`
- `IntentRouter` class export -- replaced by `IntentRouterService`
- `WorkflowManager` class export -- needs `WorkflowService` created first

## Codebase State Findings

### Verified Current State (HIGH confidence)
1. **All imperative manager files are deleted** -- `tool/registry.ts`, `agent/manager.ts`, `pipeline/manager.ts`, `context/manager.ts`, `hooks/manager.ts`, `platform/registry.ts`, `message-processor/processor.ts` (RMVL wrappers) do not exist.
2. **`exports.ts` has zero imperative manager class exports** -- no ToolRegistry, AgentManager, ContextManager, HookManager, or MessageRouter exports. API-01 is essentially satisfied.
3. **Build passes** -- `bun run build` succeeds for all 8 packages with zero errors.
4. **All 1625 tests pass** -- zero failures across 109 test files.
5. **No `@ts-ignore` or `@ts-expect-error` annotations** in `packages/core/src/`.
6. **Boundary guard test** at `tests/unit/core/migration/phase-44-boundary-guard.test.ts` is up to date with correct exception list.
7. **WorkflowManager has NO Effect service equivalent** -- only the imperative class exists (82 lines, depends on `Fred` import for agent validation).
8. **`evaluation` namespace** already exists in `index.ts` as a convenience object grouping eval functions.
9. **Changesets tooling** is configured with `@changesets/changelog-github` and `baseBranch: "main"`.
10. **Dev chat imports `WorkflowManager`** from `@fancyrobot/fred` -- consumer dependency that must be handled.

### Items Requiring Action
1. Create `WorkflowService` Effect service (locked decision)
2. Add missing service tag re-exports to main entrypoint (API-02)
3. Move eval exports to `@fancyrobot/fred/eval` sub-path
4. Move storage exports to context sub-paths
5. Move `createCalculatorTool` to `@fancyrobot/fred/tools`
6. Remove `IntentMatcher`/`IntentRouter` class exports from `exports.ts`
7. Remove `WorkflowManager` class export after service replacement
8. Add `"exports"` field entries to `package.json`
9. Update CLI/dev consumer imports for moved exports
10. Create v0.3.0 changeset with before/after migration examples
11. Run `bunx tsc --noEmit` to check for LSP-level type errors
12. Build smoke test verifying dist output has correct exports

## Discretion Recommendations

### Provider Pack Export Location
**Recommendation: Keep on main path.** All 5 provider packages import `registerBuiltinPack` and `EffectProviderFactory` from `@fancyrobot/fred`. These are lightweight imports (a function and a type). Moving them to a sub-path would force all provider packages to update imports for no user benefit. Provider pack registry functions are part of the core framework API.

### Build Scope
**Recommendation: All packages.** The existing `bun run build` script already builds all packages via `bun run --filter './packages/*' build`. Since CLI and dev packages depend on core, and provider packages depend on core types, all packages must build cleanly. No need to change scope.

### Sub-Path Naming Conventions
**Recommendation:** Use domain-aligned paths that match the internal module structure:
- `@fancyrobot/fred/eval` -- evaluation framework
- `@fancyrobot/fred/context/sqlite` -- SQLite storage
- `@fancyrobot/fred/context/postgres` -- PostgreSQL storage
- `@fancyrobot/fred/tools` -- built-in tools
- `@fancyrobot/fred/effect` -- existing power-user Effect API
- `@fancyrobot/fred/mcp/types` -- MCP types (preserve existing deep import)
- `@fancyrobot/fred/mcp/registry` -- MCP registry (preserve existing deep import)

### Observability Export Location
**Recommendation: Keep on main path.** Observability exports (`buildObservabilityLayers`, `ObservabilityService`, correlation context utilities) are used directly by the CLI eval command (`ObservabilityServiceLive`) and are core framework concerns. Effect ecosystem packages (e.g., `@effect/opentelemetry`) export observability integrations from the main package path, not sub-paths. Keep observability exports on `@fancyrobot/fred`.

## Open Questions

1. **Deep import handling with exports field**
   - What we know: Bun workspace resolution currently allows deep imports (e.g., `@fancyrobot/fred/mcp/types`) even without them in the `exports` field. Adding explicit `exports` may break this.
   - What's unclear: Whether Bun respects `exports` field restrictions for workspace packages. Need to test.
   - Recommendation: Add known deep imports to the exports field. If Bun ignores exports for workspaces, the field still serves as documentation. Test empirically after adding.

2. **TypeScript noEmit check**
   - What we know: Build passes and tests pass. There may be type errors visible to `tsc --noEmit` that Bun's bundler silently ignores.
   - What's unclear: Whether any LSP errors remain from the migration.
   - Recommendation: Run `bunx tsc --noEmit` early in the phase to discover any hidden type errors.

3. **Eval barrel completeness**
   - What we know: `packages/core/src/eval/index.ts` currently only exports suite types. The full eval API (assertions, comparator, golden-trace, recorder, replay, service, storage, metrics, normalizer, artifact) is exported via `exports.ts` barrel re-exports.
   - What's unclear: Whether the eval barrel needs to be expanded to cover ALL eval types for the sub-path, or if a new barrel file is needed.
   - Recommendation: Create a comprehensive eval barrel at `packages/core/src/eval/public.ts` (or expand `index.ts`) that re-exports everything the CLI needs, then point the sub-path at it.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/core/src/exports.ts` (109 lines, verified no imperative class exports)
- Codebase analysis: `packages/core/src/services.ts` (463 lines, all service tags and layer composition)
- Codebase analysis: `packages/core/src/index.ts` (~1422 lines, Fred class + re-exports)
- Codebase analysis: `packages/core/package.json` (exports field, dependencies)
- Codebase analysis: `packages/core/src/workflow/manager.ts` (82 lines, WorkflowManager class)
- Codebase analysis: `.changeset/config.json` (changesets configuration)
- Test run: `bun test` -- 1625 pass, 0 fail (2026-03-01)
- Build run: `bun run build` -- all packages succeed (2026-03-01)
- Grep scan: zero `@ts-ignore`/`@ts-expect-error` in core/src

### Secondary (MEDIUM confidence)
- Effect ecosystem pattern: Observability exports kept on main path (consistent with `@effect/opentelemetry` main-path exports)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tooling is already in the project
- Architecture: HIGH -- patterns are established in codebase; export reorganization is mechanical
- Pitfalls: HIGH -- all identified from direct codebase analysis of actual consumer imports
- WorkflowService: HIGH -- small scope (82-line class, 4 methods), clear Effect service pattern established by 8 prior services

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable project internals, no external dependency changes expected)
