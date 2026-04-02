---
phase: 50-security-hardening-baseline
plan: 01
subsystem: security
tags: [bun, dev-server, cors, auth, rate-limiting]

requires:
  - phase: 49-peripheral-boundary-migration
    provides: Effect-first service/runtime boundaries and stable v0.3 baseline for hardening follow-up
provides:
  - Dev server auth gate with local-request bypass and bearer token checks
  - CORS allowlist matching with localhost port wildcards and no wildcard ACAO responses
  - In-memory per-IP sliding-window rate limiter with cleanup and retry-after signaling
  - Bun.serve hardening via maxRequestBodySize and idleTimeout wiring in ServerApp
affects: [phase-50-security-followups, dev-server, mcp-hardening, ci-security-scans]

tech-stack:
  added: []
  patterns: [deny-by-default CORS, explicit non-local auth gating, per-IP sliding-window throttling]

key-files:
  created:
    - packages/dev/src/server/security.ts
    - packages/dev/src/server/rate-limiter.ts
    - tests/unit/dev/security.test.ts
    - tests/unit/dev/rate-limiter.test.ts
  modified:
    - packages/dev/src/server/app.ts

key-decisions:
  - "Client address is sourced from server.requestIP(req)?.address for auth/rate decisions instead of URL hostname."
  - "CORS headers are emitted only when Origin matches configured allowlist patterns, including :* port wildcard support."

patterns-established:
  - "Server hardening pattern: rate-limit check -> auth check -> route execution -> conditional CORS headers"

duration: 3 min
completed: 2026-03-05
---

# Phase 50 Plan 01: Security Hardening Baseline Summary

**Dev server now enforces non-local bearer auth, deny-by-default CORS allowlists, Bun request-size/time limits, and per-IP sliding-window throttling.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T06:01:14Z
- **Completed:** 2026-03-05T06:04:45Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `security.ts` with `ServerSecurityConfig`, secure defaults, local-request detection, origin matching, and auth validation.
- Added `rate-limiter.ts` with in-memory sliding-window throttling, stale-entry cleanup, and disposable cleanup interval.
- Wired security controls into `ServerApp` with Bun request limits/timeouts, pre-route 429/401 gates, and allowlist-only CORS headers.
- Added unit coverage for auth/CORS matcher behavior and rate limiter window/reset/cleanup behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): Create security module and rate limiter with tests** - `cb155a3` (test)
2. **Task 1 (TDD GREEN): Create security module and rate limiter with tests** - `6d4c938` (feat)
3. **Task 2: Wire security controls into ServerApp** - `e6974a6` (feat)

**Plan metadata:** (created in final docs commit for this plan)

## Files Created/Modified
- `packages/dev/src/server/security.ts` - security config defaults and helpers (`isLocalRequest`, `matchOrigin`, `checkAuth`).
- `packages/dev/src/server/rate-limiter.ts` - per-IP sliding-window limiter with `check()`, `cleanup()`, and `dispose()`.
- `packages/dev/src/server/app.ts` - Bun.serve security wiring (max body size, idle timeout, rate limiting, auth, conditional CORS).
- `tests/unit/dev/security.test.ts` - auth and origin-allowlist behavior tests.
- `tests/unit/dev/rate-limiter.test.ts` - rate-limiter behavior tests (limit, window expiry, cleanup).

## Decisions Made
- Used `server.requestIP(req)?.address` for request source identity, preserving correctness behind URL host ambiguity.
- Kept localhost loopback (`127.0.0.1`, `::1`) auth bypass for dev ergonomics while requiring non-local bearer auth.
- Returned preflight `204` without CORS headers for disallowed origins to enforce browser-side deny-by-default behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed wildcard-origin matcher implementation during Task 1 GREEN phase**
- **Found during:** Task 1 verification (`bun test tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts`)
- **Issue:** Initial wildcard matcher used invalid regex construction, causing runtime regex errors and failing CORS match tests.
- **Fix:** Replaced regex-based conversion with deterministic `:*` port-wildcard + exact-origin matching logic.
- **Files modified:** `packages/dev/src/server/security.ts`
- **Verification:** Task 1 test suite passed (13/13)
- **Committed in:** `6d4c938`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was required to satisfy wildcard CORS matching correctness; no scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Security hardening baseline for SEC-01 and SEC-02 is complete and verified.
- Ready for phase transition or follow-on hardening work (MCP trust boundaries and CI scanners) if additional plans are added.

---
*Phase: 50-security-hardening-baseline*
*Completed: 2026-03-05*
