# Phase 44: Imperative Layer Removal & Consumer Migration - Research

**Researched:** 2026-03-01
**Domain:** Effect-TS migration / dead code removal / consumer API migration
**Confidence:** HIGH

## Summary

Phase 44 is a deletion and migration phase. All 6 imperative manager classes (ToolRegistry, AgentManager, PipelineManager, ContextManager, HookManager, ProviderRegistry) are redundant since Phase 43 completed the Fred facade migration to Effect services. The consumers (dev-chat.ts, CLI chat.ts, CLI run.ts) already interact with Fred's public API -- they do NOT directly instantiate imperative managers. The primary migration work is: (1) removing `getContextManager()` calls in consumers that rely on the compatibility shim and replacing them with Fred's direct session/context API, (2) removing the 3 Promise-wrapper methods from MessageProcessor, (3) deleting the 6 manager files, and (4) cleaning up exports and internal references.

The codebase evidence shows that consumers use Fred's public methods (`processMessage`, `streamMessage`, `getAgents`, `createAgent`, `initializeFromConfig`, etc.) which already delegate to Effect services. The `getContextManager()` compatibility shim on Fred returns a proxy object backed by ContextStorageService -- consumers call methods like `generateConversationId()`, `setStorage()`, `setDefaultPolicy()`, `listSessions()`, `getSession()`, `deleteSession()` through this proxy. Migration means replacing these proxy calls with Fred's direct methods.

**Primary recommendation:** Migrate consumers first (CLI before dev-chat), then delete manager files in dependency order (simple to complex), then clean up tests. Pre-create a safety checkpoint tag before any deletions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Deletion strategy:**
- Delete manager files in multiple commits, not a single monolithic deletion
- Delete in order: simple to complex (ContextManager, HookManager, ProviderRegistry -> ToolRegistry, AgentManager -> PipelineManager)
- Verify all references are gone (grep returns zero) before deleting each file
- Delete message-processor/processor.ts Promise-wrapper methods BEFORE manager file deletions
- Create a pre-deletion checkpoint (git tag or branch) for safety before starting deletions
- If any additional imperative wrapper classes beyond the 6 listed managers are found, delete them too in this phase
- Clean slate: no commented-out code or type aliases remain
- Delete tests for imperative managers AFTER managers are deleted (let them fail first, understand coverage, then remove in follow-up)

**Consumer migration order:**
- Migrate consumers BEFORE deleting manager files
- Migrate one consumer at a time, not all together
- Run smoke tests after EACH consumer migration, not waiting until all are done
- Migrate in order: CLI first (chat.ts, run.ts), then dev-chat.ts
- Update consumer code and tests in SEPARATE commits (migrate consumer, then update tests in follow-up)
- Migrate ALL helper functions that internally use imperative managers, not just public surface API
- Update consumer error handling to use Effect patterns (not preserve imperative exception patterns)
- Update consumer logging/observability to reflect Effect-based execution where appropriate
- Update ALL consumer configuration references to imperative manager types
- Convert consumers to Effect-based async patterns throughout (not just wrap at boundary)
- Allow consumer output format improvements where beneficial (not locked to exact pre-migration format)
- Create consumer-specific helper functions if migration patterns repeat

**Runtime boundary enforcement:**
- Practical enforcement: focus on business logic, allow Effect.runPromise in test helpers if needed
- Zero tolerance in business logic, pragmatic in test infrastructure
- What counts as application boundary: entry points + small boundary helper functions (if they don't contain business logic)
- Add verification tests (guard tests) that grep for Effect.runPromise usage patterns to prevent future violations
- Fix any existing Effect.runPromise violations in non-boundary code immediately when found during migration
- Do NOT add explicit boundary comments (code structure should make boundaries obvious)
- Handle Effect.runPromise in error recovery by refactoring to Effect error handling patterns
- Document the runtime boundary pattern in AGENTS.md or architectural docs
- Create automated checks (lint rules or static analysis) if feasible, otherwise manual review

**Test cleanup scope:**
- Keep verification tests for imperative managers (tests that verify managers were working correctly) rather than deleting all immediately
- Update tests that indirectly test imperative managers through other services to use Effect services directly
- Delete test files AFTER manager file deletions (not before)
- Update all test mocks and fixtures that reference imperative manager classes to use Effect service mocks
- Test cleanup happens in follow-up commits after seeing what fails from manager deletion

### Claude's Discretion
- Whether to add automated lint rules for boundary enforcement or rely on manual review (assess feasibility)
- Exact grouping of manager deletions across multiple commits (within the simple-to-complex ordering)
- Whether small boundary helper functions are truly boundary-eligible or contain business logic
- Which verification tests for managers provide value vs redundancy after manager deletion

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RMVL-01 | `tool/registry.ts` (ToolRegistry class) is deleted | File exists at 190 lines; referenced by `agent/factory.ts`, `agent/service.ts`, `agent/manager.ts`, `exports.ts`. Delete after removing all imports. |
| RMVL-02 | `agent/manager.ts` (AgentManager class) is deleted | File exists at 232 lines; referenced by `pipeline/manager.ts`, `routing/router.ts`, `message-processor/types.ts`, `pipeline/executor.ts`, `pipeline/graph-executor.ts`, `pipeline/service.ts`, `provider/service.ts`, `exports.ts`. Heavy reference graph. |
| RMVL-03 | `pipeline/manager.ts` (PipelineManager class) is deleted | File exists at 1062 lines (largest); referenced by `message-processor/types.ts`, `exports.ts` (implicitly via re-exports). |
| RMVL-04 | `context/manager.ts` (ContextManager class) is deleted | File exists at 296 lines; referenced by `message-processor/types.ts`, `pipeline/manager.ts`, `exports.ts`, `cli/src/tui/session.ts`, `dev/src/server/chat/handlers.ts`. |
| RMVL-05 | `hooks/manager.ts` (HookManager class) is deleted | File exists at 343 lines; referenced by `pipeline/manager.ts`, `pipeline/executor.ts`, `pipeline/graph-executor.ts`, `routing/router.ts`, `message-processor/types.ts`, `exports.ts`. Contains 5 `Effect.runPromise` boundary violations. |
| RMVL-06 | `platform/registry.ts` (ProviderRegistry class) is deleted | File exists at 131 lines; referenced by `provider/service.ts`, `exports.ts` (not directly exported but `ProviderRegistry` symbol not in exports). |
| RMVL-07 | `message-processor/processor.ts` imperative wrapper methods removed | File has 3 Promise-wrapper methods at lines ~410, ~886, ~1455 (`routeMessage`, `processMessage`, `processChatMessage`) that call `Effect.runPromise` internally. These must be deleted. The Effect-based methods (`routeMessageEffect`, `processMessageEffect`, `processChatMessageEffect`, `streamMessageEffect`) remain. |
| RMVL-08 | No remaining `new XxxManager()` calls in codebase | Currently 35+ `new XxxManager()` calls exist, all in test files and 1 in `agent/service.ts` (`new ToolRegistry()`). Production code: `agent/service.ts:112` and `agent/service.ts:193` use `new ToolRegistry()`. |
| CONS-01 | `dev-chat.ts` uses Effect-based API | Currently uses `fred.getContextManager()` (3 places), `fred.processMessage()`, `fred.streamMessage()`, `fred.getAgents()`, `fred.getWorkflowManager()`. The `getContextManager()` calls need replacement. |
| CONS-02 | `chat.ts` uses Effect-based API | Uses `fred.getContextManager()` (3 places for setStorage, generateConversationId, and session service passthrough), `fred.streamMessage()`, `fred.getAgents()`, `fred.setToolPolicies()`, `fred.initializeFromConfig()`. The `getContextManager()` calls need replacement. |
| CONS-03 | `run.ts` uses Effect-based API | Uses `fred.processMessage()`, `fred.getAgent()`, `fred.getAgents()`, `fred.initializeFromConfig()`. Already mostly clean. No `getContextManager()` or direct manager access. |
| CONS-04 | Effect.runPromise at boundary only | Current boundary violations in production code: `hooks/manager.ts` (5 calls), `message-processor/processor.ts` (3 calls), `intent/router.ts` (2 calls), `mcp/health.ts` (1 call). Consumer boundary calls (chat.ts:393, run.ts:220) are at entry points and are acceptable. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Effect | current (workspace) | Service composition, typed errors, Ref-based state | Already the foundation; all services built on it |
| Bun | workspace runtime | Test runner, bundler, runtime | Already the project runtime |
| @effect/ai | current (workspace) | AI provider integration, Prompt types | Already used for message types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | built-in | Unit testing | All new guard tests and updated tests |

### Alternatives Considered
None. This phase uses only existing project dependencies. No new libraries needed.

## Architecture Patterns

### Pattern 1: Fred Facade as Consumer API Surface
**What:** Consumers interact with Fred's public methods only, never reaching into internal service implementations or imperative manager classes. Fred's `runEffect()` method is the single boundary between Promise-world and Effect-world.
**When to use:** All consumer code.
**Example:**
```typescript
// CORRECT: Consumer uses Fred public API
const fred = await Fred.create();
await fred.initializeFromConfig(configPath);
const response = await fred.processMessage(message, { conversationId });

// WRONG: Consumer reaches into internal managers
const contextManager = fred.getContextManager();
await contextManager.addMessage(conversationId, message);
```

### Pattern 2: Compatibility Shim Proxy (Current State to Remove)
**What:** Fred's `getContextManager()` returns a proxy object backed by ContextStorageService, not a real ContextManager instance. This exists for backward compatibility during Phase 43 transition.
**When to use:** Being removed in this phase.
**Current implementation location:** `packages/core/src/index.ts:882-955` (computed property name to evade static analysis guards)

### Pattern 3: Effect.runPromise at Application Boundary
**What:** `Effect.runPromise` / `Runtime.runPromise` calls appear only at entry points (CLI main, test setup), not scattered through business logic.
**When to use:** Always. Business logic stays pure Effect; only entry points bridge to Promise.
**Example:**
```typescript
// BOUNDARY (OK): CLI entry point
export async function handleRunCommand(args, options, deps) {
  return Effect.runPromise(
    runCommandEffect(args, options, deps, channel).pipe(
      Effect.catchTags({ /* error handling */ })
    )
  );
}

// VIOLATION (remove): Business logic calling Effect.runPromise
async routeMessage(message, semanticMatcher, previousMessages, options) {
  return Effect.runPromise(
    this.routeMessageEffect(message, semanticMatcher, previousMessages, options)
  );
}
```

### Pattern 4: Consumer Migration with Session Service Passthrough
**What:** The `session.ts` TUI module imports `ContextManager` type from `@fancyrobot/fred` and uses it as a `SessionServiceDependencies.contextManager`. After migration, consumers pass the Fred proxy (which already conforms to the needed interface) directly.
**When to use:** Session management in TUI.

### Anti-Patterns to Avoid
- **Importing imperative manager types in consumer code:** After migration, no consumer file should import `ContextManager`, `AgentManager`, etc. from `@fancyrobot/fred`
- **Creating new compatibility shims:** Do not add new proxy methods to Fred to "ease" migration. Clean break.
- **Leaving dead type imports:** Even `type` imports of deleted classes must be removed
- **Scattering Effect.runPromise through helper functions:** Keep it at the outermost boundary only

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session management API | Custom session wrapper | Fred's existing `listSessions()`, `getSession()`, `exportSession()`, `deleteSession()` | These methods already exist on Fred and delegate to ContextStorageService |
| Conversation ID generation | Custom ID generator | Fred's proxy already returns `conv_*` IDs pre-runtime | Pre-runtime stub already handles this case |
| Storage replacement | Custom storage bridge | Fred's `getContextManager().setStorage()` proxy (or direct ContextStorageService via runtime) | ExternalStorageAdapter already bridges legacy storage |

**Key insight:** The Fred class already provides all the APIs consumers need. The migration is about switching from `fred.getContextManager().method()` to `fred.method()` for the handful of methods consumers actually use.

## Common Pitfalls

### Pitfall 1: Deleting Files Before Removing All References
**What goes wrong:** TypeScript compilation fails because import statements still point to deleted files.
**Why it happens:** The reference graph for imperative managers is deep. `AgentManager` is imported by 8+ files including `router.ts`, `executor.ts`, `graph-executor.ts`, `pipeline/service.ts`.
**How to avoid:** Run `grep -r "from '.*/<filename>'" packages/` before each deletion. Fix all imports first.
**Warning signs:** TypeScript errors mentioning "cannot find module".

### Pitfall 2: Breaking MessageProcessorDeps Type
**What goes wrong:** `message-processor/types.ts` defines `MessageProcessorDeps` which references `AgentManager`, `ContextManager`, `PipelineManager`, `HookManager`. Deleting managers without updating this interface breaks the MessageProcessor class.
**Why it happens:** The imperative `MessageProcessor` class uses this deps interface. The class itself also needs to be cleaned up or deleted.
**How to avoid:** Delete `MessageProcessor` Promise-wrapper methods (RMVL-07) first, then either update `MessageProcessorDeps` to use Effect service types or delete it if the imperative MessageProcessor class is no longer needed.
**Warning signs:** Type errors in `processor.ts` after manager file deletions.

### Pitfall 3: Internal Code Using Imperative Types for Service Composition
**What goes wrong:** Several internal files use imperative types for dependency injection even though they're Effect services. For example: `pipeline/executor.ts` imports `HookManager` and `AgentManager`; `routing/router.ts` takes `AgentManager` in its constructor; `pipeline/service.ts` imports `AgentManager` and `HookManager` types.
**Why it happens:** The Effect services were built alongside imperative classes and some share type dependencies.
**How to avoid:** After deleting managers, replace these type references with either Effect service types or extract minimal interfaces. The executor and graph-executor need special attention since they take `AgentManager` and `HookManager` as constructor/parameter types.
**Warning signs:** Import errors in executor files.

### Pitfall 4: AgentService Internal ToolRegistry Usage
**What goes wrong:** `agent/service.ts` at lines 112 and 193 directly creates `new ToolRegistry()` instances. Deleting `tool/registry.ts` breaks AgentService.
**Why it happens:** AgentService bootstraps an AgentFactory which requires a concrete ToolRegistry. This was a Phase 41 decision to sync a concrete ToolRegistry into AgentFactory at create-time.
**How to avoid:** Before deleting `tool/registry.ts`, refactor `agent/service.ts` to either (a) use ToolRegistryService directly, or (b) create a minimal tool collection object that satisfies AgentFactory's needs without the full ToolRegistry class.
**Warning signs:** `agent/service.ts` import of `ToolRegistry` failing after deletion.

### Pitfall 5: AgentFactory Direct ToolRegistry Import
**What goes wrong:** `agent/factory.ts:11` imports ToolRegistry directly for its constructor parameter type.
**Why it happens:** AgentFactory predates the Effect service layer.
**How to avoid:** Change AgentFactory to accept an interface/type that matches what it needs, rather than the concrete ToolRegistry class.
**Warning signs:** Factory creation failing in agent service.

### Pitfall 6: Exports.ts Still Re-Exporting Deleted Classes
**What goes wrong:** External consumers who import `ToolRegistry`, `AgentManager`, `ContextManager`, `HookManager`, `IntentMatcher`, `IntentRouter`, `MessageRouter` from `@fancyrobot/fred` get broken imports.
**Why it happens:** `exports.ts` explicitly re-exports these classes.
**How to avoid:** Remove the export lines for deleted classes from `exports.ts`. Note: `exports.ts` cleanup is partially Phase 45 scope (API-01), but the file-deletion in Phase 44 forces removing at minimum the exports for deleted files.
**Warning signs:** Build errors in consumer packages.

### Pitfall 7: dev-chat.ts ServerApp and ChatHandlers Direct ContextManager Usage
**What goes wrong:** `packages/dev/src/server/app.ts:22` calls `framework.getContextManager()` and passes it to `ChatHandlers`. `packages/dev/src/server/chat/handlers.ts:1` imports `ContextManager` from `@fancyrobot/fred` and uses it as a class instance type.
**Why it happens:** The HTTP server was written before the Effect migration.
**How to avoid:** Update ChatHandlers to use the Fred proxy (which returns a ContextManager-like interface) or use Fred's public session methods directly.
**Warning signs:** Server chat routes failing after ContextManager deletion.

### Pitfall 8: CLI session.ts Importing ContextManager Type
**What goes wrong:** `packages/cli/src/tui/session.ts:2` imports `{ ContextManager }` from `@fancyrobot/fred` as a concrete type for SessionServiceDependencies.
**Why it happens:** Session service was written to depend on the ContextManager class type.
**How to avoid:** Change SessionServiceDependencies to use an interface that matches the proxy's shape rather than the concrete ContextManager class.
**Warning signs:** TUI session module compilation errors.

### Pitfall 9: eval.ts getPipelineManager() Call
**What goes wrong:** `packages/cli/src/eval.ts:234` calls `fred.getPipelineManager().resume(runId, { mode })`.
**Why it happens:** Eval replay runtime was wired to the imperative pipeline manager.
**How to avoid:** Replace with `fred.resume(runId, { humanInput: '', resumeBehavior: 'continue' })` or the appropriate Fred public API call for pipeline resume.
**Warning signs:** Eval replay failing.

## Code Examples

### Example 1: Replacing getContextManager() in CLI chat.ts
```typescript
// BEFORE (current):
import { Fred, SqliteContextStorage } from '@fancyrobot/fred';

function configureChatFallbackPersistence(
  fred: Pick<Fred, 'getContextManager'>,
  sqlitePath = process.env.FRED_SQLITE_PATH || './fred.db',
  createStorage: ChatDependencies['createStorage'] = DEFAULT_DEPS.createStorage,
): void {
  fred.getContextManager().setStorage(createStorage({ path: sqlitePath }) as any);
}

// AFTER (migrated):
// Fred's getContextManager() proxy already works, but the typing should change
// to avoid importing ContextManager. The proxy interface matches what's needed.
// If Fred exposes a direct setStorage() method, use it. Otherwise, the proxy
// continues to work since Fred.getContextManager() returns Effect-backed proxy.
```

### Example 2: Replacing ContextManager Type in session.ts
```typescript
// BEFORE:
import { ContextManager } from '@fancyrobot/fred';
export interface SessionServiceDependencies {
  contextManager: ContextManager;
}

// AFTER:
// Define a minimal interface matching the subset of methods used
export interface SessionContextService {
  listSessions(): Promise<import('@fancyrobot/fred').SessionSummary[]>;
  generateConversationId(): string;
  getContext(id: string): Promise<any>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  getSession(id: string): Promise<any>;
  deleteSession(id: string): Promise<void>;
}

export interface SessionServiceDependencies {
  contextManager: SessionContextService;
}
```

### Example 3: Removing MessageProcessor Promise Wrappers
```typescript
// BEFORE: Three Promise-wrapper methods exist
async routeMessage(...): Promise<RouteResult> {
  return Effect.runPromise(this.routeMessageEffect(...));
}

async processMessage(...): Promise<AgentResponse | null> {
  return Effect.runPromise(this.processMessageEffect(...));
}

async processChatMessage(...): Promise<AgentResponse | null> {
  return Effect.runPromise(this.processChatMessageEffect(...));
}

// AFTER: Delete these three methods entirely.
// The Effect-based methods (routeMessageEffect, processMessageEffect, etc.) remain.
// MessageProcessorService already uses the Effect-based methods directly.
```

### Example 4: Removing Imperative Type References from Internal Code
```typescript
// BEFORE (message-processor/types.ts):
import type { AgentManager } from '../agent/manager';
import type { ContextManager } from '../context/manager';
import type { PipelineManager } from '../pipeline/manager';
import type { HookManager } from '../hooks/manager';

export interface MessageProcessorDeps {
  contextManager: ContextManager;
  agentManager: AgentManager;
  pipelineManager: PipelineManager;
  hookManager?: HookManager;
  // ...
}

// AFTER: Either delete MessageProcessorDeps entirely (if imperative
// MessageProcessor class is deleted) or replace with minimal interfaces.
// The Effect MessageProcessorService doesn't use this interface.
```

### Example 5: Guard Test for Boundary Enforcement
```typescript
// New test: tests/unit/core/migration/phase-44-boundary-guard.test.ts
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Runtime boundary enforcement', () => {
  test('Effect.runPromise not used in core business logic', () => {
    const coreDir = join(process.cwd(), 'packages/core/src');
    const boundaryFiles = new Set([
      'index.ts', // Fred class (application boundary)
      'services.ts', // Runtime factory (infrastructure)
    ]);

    const violations: string[] = [];
    for (const file of collectTsFiles(coreDir)) {
      const relative = file.replace(coreDir + '/', '');
      if (boundaryFiles.has(relative)) continue;
      if (relative.includes('.test.')) continue;

      const content = readFileSync(file, 'utf-8');
      if (content.includes('Effect.runPromise') || content.includes('Runtime.runPromise')) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Imperative manager classes with mutable state | Effect services with Ref-based state | Phase 41-42 | Effect services are the source of truth |
| Fred delegates to imperative managers | Fred delegates to Effect runtime | Phase 43 | Managers are now dead code |
| Consumers use `fred.getContextManager()` | Fred proxy wraps ContextStorageService | Phase 43 | Proxy exists; can be simplified |
| MessageProcessor has both Effect and Promise APIs | Effect-only API via MessageProcessorService | Phase 42 | Promise wrappers are dead code |

**Deprecated/outdated:**
- `ToolRegistry` class: Replaced by `ToolRegistryService` (Effect)
- `AgentManager` class: Replaced by `AgentService` (Effect)
- `PipelineManager` class: Replaced by `PipelineService` (Effect)
- `ContextManager` class: Replaced by `ContextStorageService` (Effect)
- `HookManager` class: Replaced by `HookManagerService` (Effect)
- `ProviderRegistry` class: Replaced by `ProviderRegistryService` (Effect)
- `MessageProcessor` Promise wrappers: Replaced by `MessageProcessorService` Effect methods

## Open Questions

1. **Should the imperative MessageProcessor class itself be deleted?**
   - What we know: The MessageProcessorService delegates to the imperative MessageProcessor class internally (it still uses `MessageProcessorDeps` and the class for actual routing/processing logic). The service wraps the class.
   - What's unclear: Whether deleting the imperative MessageProcessor is in scope for Phase 44 or whether only the 3 Promise-wrapper methods (RMVL-07) are targeted. The class itself is used by the Effect service.
   - Recommendation: Only delete the 3 Promise-wrapper methods as specified in RMVL-07. The MessageProcessor class can remain as internal implementation detail of the service layer, but remove its dependency on imperative manager types by switching to interfaces.

2. **How to handle executor.ts and graph-executor.ts imports of AgentManager/HookManager?**
   - What we know: `pipeline/executor.ts` imports `{ HookManager }` from `../hooks/manager` and `{ AgentManager }` from `../agent/manager`. `pipeline/graph-executor.ts` imports type references to both. These are used in the `ExecutorOptions` type.
   - What's unclear: Whether these should be replaced with interfaces or with Effect service types.
   - Recommendation: Replace with minimal interfaces matching the subset of methods used. The executors are imperative code that the Effect PipelineService wraps, so they can use interfaces rather than Effect service types.

3. **Should `provider/service.ts` (ProviderService class) be deleted?**
   - What we know: `ProviderService` at `packages/core/src/provider/service.ts` wraps ProviderRegistry and AgentManager. It is the "old" bridging service. Fred's `getProviderService()` returns a proxy.
   - What's unclear: Whether this file is in scope for Phase 44 deletion (it's not in the 6 listed managers, but it's an imperative wrapper).
   - Recommendation: Per user decision "If any additional imperative wrapper classes beyond the 6 listed managers are found, delete them too in this phase." This file should be assessed and likely deleted.

4. **Should `MessageRouter` class be deleted?**
   - What we know: `routing/router.ts` contains the `MessageRouter` class which takes `AgentManager` and `HookManager` in its constructor. `MessageRouterService` wraps it. It's exported from `exports.ts`.
   - What's unclear: Whether MessageRouter counts as an "additional imperative wrapper class" per the user decision.
   - Recommendation: Assess during implementation. If MessageRouterService fully replaces it (it does -- it creates the router internally), then delete it. The user decision says to delete any additional imperative wrappers found.

5. **What about the `IntentMatcher` and `IntentRouter` classes?**
   - What we know: These are exported from `exports.ts`. They have corresponding Effect services (`IntentMatcherService`, `IntentRouterService`).
   - What's unclear: Whether they're in scope. They're not manager classes but they follow the same pattern.
   - Recommendation: Not in Phase 44 scope unless they block deletion of the 6 targeted managers. They don't import any of the 6 manager files, so they can be left for Phase 45 (API cleanup).

## Detailed Reference Graph

### Files to Delete (with inbound references)

**`tool/registry.ts`** (ToolRegistry class)
- `agent/factory.ts:11` -- import { ToolRegistry }
- `agent/manager.ts:4` -- import { ToolRegistry }
- `agent/service.ts:14` -- import { ToolRegistry }
- `exports.ts:18` -- re-export

**`agent/manager.ts`** (AgentManager class)
- `pipeline/manager.ts:6` -- import { AgentManager }
- `routing/router.ts:24` -- import { AgentManager }
- `message-processor/types.ts:2` -- import type { AgentManager }
- `pipeline/executor.ts:24` -- import { AgentManager }
- `pipeline/graph-executor.ts:30` -- import type { AgentManager }
- `pipeline/service.ts:36` -- import type { AgentManager }
- `provider/service.ts:10` -- import type { AgentManager }
- `exports.ts:19` -- re-export

**`pipeline/manager.ts`** (PipelineManager class)
- `message-processor/types.ts:6` -- import type { PipelineManager }
- No direct export in `exports.ts`

**`context/manager.ts`** (ContextManager class)
- `message-processor/types.ts:3` -- import type { ContextManager }
- `pipeline/manager.ts:4` -- import { ContextManager }
- `exports.ts:22` -- re-export
- `packages/cli/src/tui/session.ts:2` -- import { ContextManager }
- `packages/dev/src/server/chat/handlers.ts:1` -- import { ContextManager }

**`hooks/manager.ts`** (HookManager class)
- `pipeline/manager.ts:8` -- import { HookManager }
- `pipeline/executor.ts:22` -- import { HookManager }
- `pipeline/graph-executor.ts:26` -- import type { HookManager }
- `routing/router.ts:25` -- import { HookManager }
- `message-processor/types.ts:9` -- import type { HookManager }
- `exports.ts:53` -- re-export

**`platform/registry.ts`** (ProviderRegistry class)
- `provider/service.ts:9` -- import type { ProviderRegistry }
- Not directly re-exported from `exports.ts`

### Test Files Referencing Imperative Managers
- `tests/unit/core/tool/registry.test.ts` -- 3x new ToolRegistry()
- `tests/unit/core/agent/manager.test.ts` -- 2x new AgentManager(), 2x new ToolRegistry()
- `tests/unit/core/agent/factory.test.ts` -- 1x new ToolRegistry()
- `tests/unit/core/agent/retry.test.ts` -- 1x new ToolRegistry()
- `tests/unit/core/agent/mcp-factory.test.ts` -- 2x new ToolRegistry()
- `tests/unit/core/agent/factory-streaming.test.ts` -- 1x new ToolRegistry()
- `tests/unit/core/pipeline/manager.test.ts` -- 3x new PipelineManager(), 3x new ContextManager()
- `tests/unit/core/pipeline/manager-graph.test.ts` -- 2x new PipelineManager()
- `tests/unit/core/context/manager.test.ts` -- 2x new ContextManager()
- `tests/unit/core/context/session.test.ts` -- 1x new ContextManager()
- `tests/unit/core/hooks/manager.test.ts` -- 1x new HookManager()
- `tests/unit/core/routing/router.test.ts` -- 4x new HookManager(), 2x new AgentManager()
- `tests/unit/core/routing/hooks.test.ts` -- 1x new HookManager(), 1x new AgentManager()
- `tests/unit/core/workflow/manager.test.ts` -- 1x new AgentManager(), 1x new ToolRegistry()
- `tests/unit/core/observability/pipeline-tracing.test.ts` -- 1x new ToolRegistry(), 1x new AgentManager()
- `tests/unit/core/tool-gate/mcp-gating.test.ts` -- 1x new ToolRegistry()
- `tests/unit/cli/session-commands.test.ts` -- 1x new ContextManager()

### Consumer Files to Migrate

**`packages/cli/src/commands/chat.ts`** (CONS-02)
- Line 85-89: `configureChatFallbackPersistence` uses `fred.getContextManager().setStorage()`
- Line 239: `fred.getContextManager()` passed as `sessionService: { contextManager }`
- Line 247-251: `contextManager.generateConversationId()` and `fred.streamMessage()`
- Line 118: `fred.initializeFromConfig()`
- Line 124-165: `fred.getAgents()`, `fred.setToolPolicies()`

**`packages/cli/src/commands/run.ts`** (CONS-03)
- Already mostly clean: uses `fred.processMessage()`, `fred.getAgent()`, `fred.getAgents()`
- Line 63-68: `fred.initializeFromConfig()`
- No `getContextManager()` calls

**`packages/dev/src/dev-chat.ts`** (CONS-01)
- Line 694: `this.fred.getContextManager()` for hot-reload context migration
- Line 1187: `this.fred.getContextManager()` for context policy
- Line 1195: `this.fred.getContextManager().generateConversationId()`
- Line 1304: `this.fred.processMessage()`
- Line 1335: `this.fred.streamMessage()`
- Line 1444: `this.fred.processMessage()` (fallback)
- Line 1466: `this.fred.getAgents()`

**Supporting consumer files:**
- `packages/cli/src/tui/session.ts` -- imports ContextManager type
- `packages/cli/src/commands/session.ts:188` -- `fred.getContextManager()`
- `packages/cli/src/eval.ts:234` -- `fred.getPipelineManager().resume()`
- `packages/dev/src/server/app.ts:22` -- `framework.getContextManager()`
- `packages/dev/src/server/chat/handlers.ts:1` -- imports ContextManager class

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all referenced files
- `packages/core/src/index.ts` -- Fred class, 1300+ lines, all public API methods traced
- `packages/core/src/services.ts` -- Layer composition, runtime factory
- `packages/core/src/exports.ts` -- Public export surface
- All 6 manager files read in full
- All 3 consumer files (chat.ts, run.ts, dev-chat.ts) read in full
- grep results for all import references and `new XxxManager()` instantiations

### Secondary (MEDIUM confidence)
- Phase 43 verification report confirms Fred facade is fully Effect-backed
- STATE.md confirms Phase 43 complete, all FRED-01 through FRED-09 done
- REQUIREMENTS.md confirms RMVL-01 through CONS-04 are pending

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing project tech
- Architecture: HIGH -- all patterns directly observed in codebase, reference graph fully traced
- Pitfalls: HIGH -- every pitfall identified from actual import analysis and grep results, not hypothetical
- Consumer migration scope: HIGH -- every `getContextManager()` and manager access call identified with line numbers

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable; internal codebase analysis, no external API dependencies)
