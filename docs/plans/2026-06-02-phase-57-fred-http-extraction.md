# Phase 57 fred-http Extraction Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Extract Fred's reusable Bun HTTP server into `packages/fred-http`, add a security-first composable route API for consumer-defined handlers, migrate all consumers off `@fancyrobot/fred-dev` server exports, and validate the full migration.

**Architecture:** Create a new runtime package, `@fancyrobot/fred-http`, that owns the Bun HTTP server surface and exposes both simple startup APIs and a composable app-builder API. Move the existing server implementation from `packages/dev` into the new package with minimal semantic change first, then add the custom-route composition seam while preserving the current security pipeline and approved Effect runtime boundaries.

**Tech Stack:** Bun, TypeScript, Effect, `@effect/platform-bun`, Fred monorepo workspaces, Agent Vault

---

### Task 1: Correct the vault phase before code moves

**Files:**
- Modify: `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase.md`
- Modify: `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_01_audit-existing-fred-http-dev-server-package-api.md`
- Modify: `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_02_adjust-http-package-contract-for-sibling-file-dependency-consumption.md`
- Modify: `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_03_validate-http-layer-routes-and-temporary-sibling-install.md`
- Create: new Phase 57 step notes under `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/`

**Step 1: Rewrite the phase objective and acceptance criteria**

Change Phase 57 from “clarify sibling consumption” to “extract reusable HTTP layer into `@fancyrobot/fred-http` with composable routes and migrate consumers”.

Include acceptance criteria for:
- new package exists
- `@fancyrobot/fred-dev` no longer exports server APIs
- composable custom routes exist
- security pipeline preserved
- docs/tests/builds/sibling checks pass

**Step 2: Mark old clarification steps as superseded**

Update the three existing completed step notes so they remain historical evidence but clearly state they belong to the superseded interpretation.

Use wording like:

```md
- Historical note: this step belongs to the superseded “clarify sibling consumption” interpretation of PHASE-57 and should not be orchestrated as executable work for the current phase definition.
```

**Step 3: Create the new executable step notes**

Create step notes for:
1. scaffold `fred-http` package
2. move server runtime into `fred-http`
3. add composable custom-route API with shared security
4. migrate consumers and tests
5. update docs and run full validation

**Step 4: Refresh vault indexes**

Run vault refresh after the note updates.

Run: `vault_refresh target=all`
Expected: Active context and indexes refresh without broken generated sections.

**Step 5: Commit**

```bash
git add .agent-vault
git commit -m "docs(vault): redefine phase 57 for fred-http extraction"
```

---

### Task 2: Add a failing package-surface test for `@fancyrobot/fred-http`

**Files:**
- Create: `tests/unit/http/package-surface.test.ts`
- Test: `tests/unit/http/package-surface.test.ts`

**Step 1: Write the failing test**

Create a test that expects the new package to export both simple-mode and composable-mode entrypoints.

```ts
import { describe, expect, it } from 'bun:test'
import * as httpPkg from '../../../packages/fred-http/src/index'

describe('fred-http package surface', () => {
  it('exports simple-mode server APIs', () => {
    expect(typeof httpPkg.startServer).toBe('function')
    expect(typeof httpPkg.ServerApp).toBe('function')
  })

  it('exports security config and composable app APIs', () => {
    expect(httpPkg.DEFAULT_SECURITY_CONFIG).toBeDefined()
    expect(typeof httpPkg.createFredHttpApp).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/http/package-surface.test.ts`
Expected: FAIL because `packages/fred-http/src/index.ts` does not exist yet.

**Step 3: Create the test directory if needed**

If `tests/unit/http/` does not exist, create it before implementation.

**Step 4: Commit**

```bash
git add tests/unit/http/package-surface.test.ts
git commit -m "test(http): add fred-http package surface test"
```

---

### Task 3: Scaffold the new `packages/fred-http` workspace package

**Files:**
- Create: `packages/fred-http/package.json`
- Create: `packages/fred-http/README.md`
- Create: `packages/fred-http/src/index.ts`
- Create: `packages/fred-http/src/server.ts`
- Create: `packages/fred-http/tsconfig.json` (only if package-local config is needed; otherwise skip)
- Modify: `package.json`

**Step 1: Add the package manifest**

Create `packages/fred-http/package.json` modeled on `packages/dev/package.json` but with runtime-oriented metadata.

Use this shape:

```json
{
  "name": "@fancyrobot/fred-http",
  "version": "0.1.0",
  "description": "Fred Bun HTTP server and composable HTTP app tools",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "files": ["src", "README.md"],
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm"
  },
  "peerDependencies": {
    "@fancyrobot/fred": "^1.0.0",
    "effect": "^3.21.0",
    "@effect/platform-bun": "^0.89.0"
  },
  "devDependencies": {
    "effect": "^3.21.0",
    "@effect/platform-bun": "^0.89.0",
    "@types/bun": "latest"
  },
  "publishConfig": {
    "access": "public"
  },
  "license": "MIT"
}
```

**Step 2: Add a README stub**

Document:
- package purpose
- Bun-only runtime note
- simple mode vs composable mode
- security-first behavior

**Step 3: Add placeholder exports to satisfy the new package-surface test**

Create `packages/fred-http/src/index.ts` with temporary exports that point at `./server` and future modules.

```ts
export { startServer, ServerApp } from './server'
export { DEFAULT_SECURITY_CONFIG } from './security'
export type { ServerSecurityConfig } from './security'
export { createFredHttpApp } from './app-builder'
```

If `security.ts` / `app-builder.ts` do not exist yet, create stubs in the same task.

**Step 4: Wire the root workspace dependency**

Add `"@fancyrobot/fred-http": "workspace:*"` to the root `package.json` dependencies block.

**Step 5: Run the package-surface test**

Run: `bun test tests/unit/http/package-surface.test.ts`
Expected: either PASS or fail only on missing stub files referenced by `src/index.ts`.

**Step 6: Commit**

```bash
git add package.json packages/fred-http tests/unit/http/package-surface.test.ts
git commit -m "feat(http): scaffold fred-http package"
```

---

### Task 4: Move the existing server internals into `packages/fred-http`

**Files:**
- Create: `packages/fred-http/src/app.ts`
- Create: `packages/fred-http/src/handlers.ts`
- Create: `packages/fred-http/src/rate-limiter.ts`
- Create: `packages/fred-http/src/routes.ts`
- Create: `packages/fred-http/src/security.ts`
- Modify: `packages/fred-http/src/server.ts`
- Modify: `packages/fred-http/src/index.ts`
- Modify: `packages/dev/src/server.ts`
- Modify: `packages/dev/src/index.ts`
- Test: `tests/unit/dev/security.test.ts`
- Test: `tests/unit/dev/rate-limiter.test.ts`

**Step 1: Copy server modules first, without semantic refactoring**

Move or copy:
- `packages/dev/src/server/app.ts` -> `packages/fred-http/src/app.ts`
- `packages/dev/src/server/handlers.ts` -> `packages/fred-http/src/handlers.ts`
- `packages/dev/src/server/rate-limiter.ts` -> `packages/fred-http/src/rate-limiter.ts`
- `packages/dev/src/server/routes.ts` -> `packages/fred-http/src/routes.ts`
- `packages/dev/src/server/security.ts` -> `packages/fred-http/src/security.ts`

Adjust relative imports only.

**Step 2: Move `ServerApp` and `startServer` into the new package**

Refactor `packages/dev/src/server.ts` contents into `packages/fred-http/src/server.ts`.

Keep runtime boundaries in the entrypoint layer only. Do not introduce new `Effect.runPromise` calls in helpers.

**Step 3: Re-export the moved APIs from `packages/fred-http/src/index.ts`**

The index should export at least:

```ts
export { startServer, ServerApp } from './server'
export { DEFAULT_SECURITY_CONFIG } from './security'
export type { ServerSecurityConfig } from './security'
```

**Step 4: Temporarily update existing tests to the new paths**

Change:
- `tests/unit/dev/security.test.ts`
- `tests/unit/dev/rate-limiter.test.ts`

to import from `../../../packages/fred-http/src/security` and `../../../packages/fred-http/src/rate-limiter`.

**Step 5: Run the moved tests**

Run: `bun test tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts`
Expected: PASS with unchanged behavior.

**Step 6: Commit**

```bash
git add packages/fred-http packages/dev/src/server.ts packages/dev/src/index.ts tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts
git commit -m "refactor(http): move server internals to fred-http"
```

---

### Task 5: Add a failing test for composable custom routes under shared security

**Files:**
- Create: `tests/unit/http/composition.test.ts`
- Test: `tests/unit/http/composition.test.ts`

**Step 1: Write the failing test for a public custom route**

```ts
import { describe, expect, it } from 'bun:test'
import { Fred } from '@fancyrobot/fred'
import { createFredHttpApp } from '../../../packages/fred-http/src/index'

describe('createFredHttpApp', () => {
  it('allows explicit public custom routes without auth', async () => {
    const fred = new Fred()
    const app = createFredHttpApp({
      fred,
      routes: [
        {
          method: 'GET',
          path: '/public/ping',
          visibility: 'public',
          handler: () => new Response('pong', { status: 200 }),
        },
      ],
    })

    const response = await app.fetch(new Request('http://localhost/public/ping'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('pong')
  })
})
```

**Step 2: Add the failing test for an authenticated custom route**

```ts
it('applies auth to private custom routes', async () => {
  const fred = new Fred()
  const app = createFredHttpApp({
    fred,
    security: { requireAuth: true, authToken: 'secret' },
    routes: [
      {
        method: 'GET',
        path: '/private/ping',
        visibility: 'authenticated',
        handler: () => new Response('pong', { status: 200 }),
      },
    ],
  })

  const unauthenticated = await app.fetch(new Request('http://localhost/private/ping'))
  expect(unauthenticated.status).toBe(401)
})
```

**Step 3: Run the test to verify it fails**

Run: `bun test tests/unit/http/composition.test.ts`
Expected: FAIL because `createFredHttpApp` is still a stub or missing behavior.

**Step 4: Commit**

```bash
git add tests/unit/http/composition.test.ts
git commit -m "test(http): add composable route security tests"
```

---

### Task 6: Implement the composable app-builder API in `fred-http`

**Files:**
- Create: `packages/fred-http/src/app-builder.ts`
- Modify: `packages/fred-http/src/app.ts`
- Modify: `packages/fred-http/src/routes.ts`
- Modify: `packages/fred-http/src/security.ts`
- Modify: `packages/fred-http/src/index.ts`
- Test: `tests/unit/http/composition.test.ts`

**Step 1: Define the public types**

Add public route-definition types in `packages/fred-http/src/app-builder.ts`.

Use a minimal shape like:

```ts
export type FredHttpRouteVisibility = 'public' | 'authenticated'

export interface FredHttpCustomRoute {
  method: string
  path: string
  visibility?: FredHttpRouteVisibility
  handler: (request: Request) => Response | Promise<Response>
}

export interface CreateFredHttpAppOptions {
  fred: Fred
  security?: Partial<ServerSecurityConfig>
  routes?: ReadonlyArray<FredHttpCustomRoute>
}
```

**Step 2: Implement `createFredHttpApp`**

Implement `createFredHttpApp(options)` so it returns a fetch-capable app object or wrapper that:
- uses the existing Fred route handling
- adds consumer-defined route matching
- applies shared security consistently
- does not require deep imports into internals

If the current `ServerApp` class is easiest to adapt, let `createFredHttpApp` compose or wrap `ServerApp` rather than duplicating route logic.

**Step 3: Keep security-first composition explicit**

Ensure the pipeline remains:
1. CORS preflight
2. route classification / public-route decision
3. rate limit
4. auth for authenticated routes
5. handler execution
6. conditional CORS headers
7. sanitized errors

Do not let consumer handlers bypass sanitized error behavior.

**Step 4: Make `ServerApp` use the shared builder where practical**

If possible, refactor `ServerApp` to consume the same route-composition primitive so fixed-mode and composable-mode behavior stay aligned.

**Step 5: Run the composition tests**

Run: `bun test tests/unit/http/composition.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/fred-http/src tests/unit/http/composition.test.ts
git commit -m "feat(http): add composable custom route API"
```

---

### Task 7: Add regression tests for sanitized failures and shared hardening

**Files:**
- Create: `tests/unit/http/error-sanitization.test.ts`
- Modify: `tests/unit/http/composition.test.ts`
- Test: `tests/unit/http/error-sanitization.test.ts`

**Step 1: Write the failing test for custom-handler exceptions**

```ts
import { describe, expect, it } from 'bun:test'
import { Fred } from '@fancyrobot/fred'
import { createFredHttpApp } from '../../../packages/fred-http/src'

describe('fred-http error sanitization', () => {
  it('sanitizes thrown errors from custom handlers', async () => {
    const fred = new Fred()
    const app = createFredHttpApp({
      fred,
      routes: [
        {
          method: 'GET',
          path: '/boom',
          visibility: 'public',
          handler: () => {
            throw new Error('sensitive failure details')
          },
        },
      ],
    })

    const response = await app.fetch(new Request('http://localhost/boom'))
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(await response.text()).not.toContain('sensitive failure details')
  })
})
```

**Step 2: Add a test that rate limiting still applies to custom authenticated routes**

Extend `tests/unit/http/composition.test.ts` to prove custom routes use the same rate-limiter path.

**Step 3: Run the tests to verify failures**

Run: `bun test tests/unit/http/composition.test.ts tests/unit/http/error-sanitization.test.ts`
Expected: FAIL until sanitization/shared rate limiting are wired correctly.

**Step 4: Implement the minimal fixes**

Adjust `packages/fred-http/src/app.ts`, `packages/fred-http/src/security.ts`, or related helpers until the tests pass without weakening existing behavior.

**Step 5: Run the tests again**

Run: `bun test tests/unit/http/composition.test.ts tests/unit/http/error-sanitization.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/fred-http/src tests/unit/http/composition.test.ts tests/unit/http/error-sanitization.test.ts
git commit -m "test(http): cover shared security and sanitized custom-route failures"
```

---

### Task 8: Migrate `packages/dev` to a dev-only package

**Files:**
- Modify: `packages/dev/src/index.ts`
- Modify: `packages/dev/src/server.ts`
- Modify: `packages/dev/package.json`
- Modify: `packages/dev/README.md`
- Test: `tests/unit/http/package-surface.test.ts`

**Step 1: Remove server exports from `packages/dev/src/index.ts`**

Reduce the file so it exports only dev-chat and related helpers.

The final shape should look like:

```ts
export { startDevChat } from './dev-chat'
export {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider,
  loadProviderPackage,
  ensureDefaultChatAgent,
} from './chat-defaults'
```

**Step 2: Decide the fate of `packages/dev/src/server.ts`**

Choose one of these, then implement it consistently:
- delete it entirely if root scripts can call `packages/fred-http/src/server.ts` directly
- keep it as a repo-local CLI bridge that imports from `@fancyrobot/fred-http` but is not exported from the package

Prefer the second option only if needed for local contributor workflows.

**Step 3: Update `packages/dev/package.json`**

Remove language implying reusable server ownership.

If `packages/dev/src/server.ts` remains as a repo-local command, keep the `server` script but make sure it runs the `fred-http`-backed entrypoint intentionally.

**Step 4: Update the README**

Document that reusable HTTP server APIs now live in `@fancyrobot/fred-http` and `@fancyrobot/fred-dev` is dev-only.

**Step 5: Run targeted checks**

Run:
- `bun test tests/unit/http/package-surface.test.ts`
- `bun run --filter '@fancyrobot/fred-dev' build`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/dev tests/unit/http/package-surface.test.ts
git commit -m "refactor(dev): remove reusable server exports from fred-dev"
```

---

### Task 9: Migrate all repo consumers to `@fancyrobot/fred-http`

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/guides/chat-api.md`
- Modify: `docs/examples/server-mode.md`
- Modify: `docs/examples/chat-tool-integration.md`
- Modify: any additional files returned by `rg -n "@fancyrobot/fred-dev|ServerApp|startServer" . -g '!node_modules'`

**Step 1: Find all old server references**

Run: `rg -n "@fancyrobot/fred-dev|ServerApp|startServer|DEFAULT_SECURITY_CONFIG|ServerSecurityConfig" . -g '!node_modules'`
Expected: only known repo references appear.

**Step 2: Update docs/import examples**

For example, replace old usage with:

```ts
import { ServerApp, createFredHttpApp } from '@fancyrobot/fred-http'
```

Keep docs explicit about:
- simple mode
- composable mode
- Bun-only runtime
- security defaults

**Step 3: Update root package dependencies if needed**

Ensure `package.json` includes `@fancyrobot/fred-http` in the workspace dependencies block.

**Step 4: Re-run the search**

Run the same `rg` command again.
Expected: old reusable-server references to `@fancyrobot/fred-dev` are gone, except intentionally retained changelog/history text.

**Step 5: Commit**

```bash
git add package.json README.md docs
 git commit -m "docs(http): migrate consumers to fred-http"
```

---

### Task 10: Add sibling-style smoke tests for package-name consumption

**Files:**
- Create: `tests/smoke/fred-http-sibling-consumption.test.ts` or `tests/unit/http/sibling-consumption.test.ts`
- Create: temporary fixture directory under `tests/fixtures/fred-http-consumer/` if needed
- Test: new sibling-consumption smoke test file

**Step 1: Write the failing smoke test**

Create a fixture or temp-dir test that installs local `file:` dependencies for:
- `@fancyrobot/fred`
- `@fancyrobot/fred-http`

Then import by package name and verify:
- `ServerApp` or `createFredHttpApp` resolves
- a minimal `GET /health` or custom `/public/ping` request works

**Step 2: Run the smoke test to verify current behavior**

Run: `bun test tests/unit/http/sibling-consumption.test.ts`
Expected: FAIL until the fixture/package metadata is correct.

**Step 3: Fix minimal package metadata issues**

Adjust only the minimal required metadata in:
- `packages/fred-http/package.json`
- root `package.json`
- fixture package manifest

Do not widen runtime scope beyond Bun.

**Step 4: Run the smoke test again**

Run: `bun test tests/unit/http/sibling-consumption.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests packages/fred-http/package.json package.json
 git commit -m "test(http): add sibling-consumption smoke coverage"
```

---

### Task 11: Run full validation for migrated consumers and HTTP package

**Files:**
- No new files unless fixes are required
- Test: affected unit, smoke, and build outputs

**Step 1: Run targeted HTTP tests**

Run:
```bash
bun test tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts tests/unit/http
```
Expected: PASS.

**Step 2: Run package builds**

Run:
```bash
bun run --filter '@fancyrobot/fred-http' build
bun run --filter '@fancyrobot/fred-dev' build
bun run --filter '@fancyrobot/fred-cli' build
```
Expected: PASS.

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

**Step 4: Run broader unit coverage if touched files warrant it**

Run: `bun test:unit`
Expected: PASS.

**Step 5: Fix only real regressions**

If failures appear, make the smallest fix, rerun the failing command, then rerun the relevant aggregate command.

**Step 6: Commit**

```bash
git add -A
git commit -m "test(http): validate fred-http extraction"
```

---

### Task 12: Finalize docs, vault status, and close the phase

**Files:**
- Modify: `.agent-vault/02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase.md`
- Modify: new Phase 57 step notes created in Task 1
- Modify: any session/outcome notes created during execution
- Modify: `packages/fred-http/README.md`
- Modify: `packages/dev/README.md`

**Step 1: Update final package docs**

Ensure `packages/fred-http/README.md` includes:
- simple mode example
- composable mode example
- public vs authenticated route example
- Bun-only note
- security note about shared pipeline and sanitized errors

**Step 2: Mark step notes complete with evidence**

For each new Phase 57 step note, update:
- `status`
- `context_status`
- execution snapshot
- validation evidence

**Step 3: Mark the phase done**

Update Phase 57 acceptance criteria to checked and set `status: completed` only after validation is complete.

**Step 4: Refresh vault indexes**

Run: `vault_refresh target=all`
Expected: Active context and phase index reflect final state.

**Step 5: Final verification search**

Run: `rg -n "@fancyrobot/fred-dev.*ServerApp|@fancyrobot/fred-dev.*startServer" . -g '!node_modules'`
Expected: no active consumer references remain.

**Step 6: Commit**

```bash
git add .agent-vault packages/fred-http/README.md packages/dev/README.md
 git commit -m "docs(vault): close phase 57 fred-http extraction"
```
