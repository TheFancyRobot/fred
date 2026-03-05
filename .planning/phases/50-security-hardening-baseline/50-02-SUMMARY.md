---
phase: 50-security-hardening-baseline
plan: 02
subsystem: security
tags: [mcp, allowlist, stdio, url-validation, env-filtering]
requires:
  - phase: 49-peripheral-boundary-migration
    provides: Effect-native MCP runtime paths ready for trust-boundary hardening
provides:
  - MCP command allowlist validation for stdio transports
  - MCP URL host and scheme allowlist validation for http/sse transports
  - allowlist-based stdio environment filtering with secure defaults
affects: [50-03 security-validation-runbook, MCP server configuration guidance]
tech-stack:
  added: []
  patterns: [constructor-time trust-boundary validation, explicit env passthrough minimization]
key-files:
  created:
    - packages/core/src/mcp/security.ts
    - tests/unit/mcp/security.test.ts
  modified:
    - packages/core/src/mcp/types.ts
    - packages/core/src/mcp/client.ts
    - packages/core/src/mcp/stdio-transport.ts
key-decisions:
  - "URL scheme defaults to ['https'] only when host allowlist is configured"
  - "Undefined allowlists preserve backward-compatible pass-through behavior"
patterns-established:
  - "Trust boundaries are enforced before transport connection"
  - "Child process env inherits only allowlisted keys plus explicit server env"
duration: 3 min
completed: 2026-03-05
---

# Phase 50 Plan 02: MCP Trust Boundaries Summary

**MCP transports now enforce command/URL allowlists and pass a minimized child-process environment by default.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T06:01:19Z
- **Completed:** 2026-03-05T06:04:32Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `MCPSecurityError`, `validateCommand`, `validateUrl`, default env allowlist, and `filterEnv` in a dedicated MCP security module.
- Extended `MCPServerConfig` with `allowedCommands`, `allowedHosts`, `allowedSchemes`, and `envAllowlist` controls.
- Wired constructor-time validation in `MCPClientImpl` and replaced stdio env passthrough with allowlist-based filtering.
- Added direct unit coverage for command, URL, scheme, invalid URL, and env filtering trust-boundary behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): Add allowlist/security failing tests** - `bb84b18` (test)
2. **Task 1 (TDD GREEN): Implement allowlist types and security module** - `c2db508` (feat)
3. **Task 2: Wire trust boundaries into client and transport** - `8cf3d10` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `packages/core/src/mcp/security.ts` - trust-boundary error type and validation/filtering helpers.
- `tests/unit/mcp/security.test.ts` - command/URL/env trust-boundary unit coverage.
- `packages/core/src/mcp/types.ts` - MCP config allowlist fields.
- `packages/core/src/mcp/client.ts` - constructor-time command/url validation and envAllowlist transport wiring.
- `packages/core/src/mcp/stdio-transport.ts` - allowlist-based env filtering before child process spawn.

## Decisions Made
- Applied default `['https']` scheme enforcement when `allowedHosts` is configured but `allowedSchemes` is not provided, to keep host allowlists secure by default.
- Kept allowlist checks opt-in (undefined means pass-through) to preserve backward compatibility with existing MCP server configs.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 50-02 deliverables and verifications are complete. Phase 50 remains in progress with security CI/runbook work pending in `50-03-PLAN.md`.

---
*Phase: 50-security-hardening-baseline*
*Completed: 2026-03-05*
