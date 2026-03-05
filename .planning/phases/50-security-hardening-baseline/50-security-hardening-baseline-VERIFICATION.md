---
phase: 50-security-hardening-baseline
verified: 2026-03-05T06:16:24Z
status: passed
score: 14/14 must-haves verified
---

# Phase 50: Security Hardening Baseline Verification Report

**Phase Goal:** Apply baseline security hardening from audit findings across the dev server, request-abuse controls, MCP trust boundaries, and CI security checks.
**Verified:** 2026-03-05T06:16:24Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Non-local requests without valid Bearer token are rejected with 401 | ✓ VERIFIED | `packages/dev/src/server/security.ts:53`, `packages/dev/src/server/security.ts:58`, `packages/dev/src/server/app.ts:94`, `packages/dev/src/server/app.ts:100`, `tests/unit/dev/security.test.ts:21` |
| 2 | CORS responses only include `Access-Control-Allow-Origin` for configured origins | ✓ VERIFIED | `packages/dev/src/server/app.ts:66`, `packages/dev/src/server/app.ts:68`, `packages/dev/src/server/app.ts:75`, `packages/dev/src/server/app.ts:109`, `packages/dev/src/server/app.ts:111` |
| 3 | Localhost requests bypass auth automatically for dev ergonomics | ✓ VERIFIED | `packages/dev/src/server/security.ts:20`, `packages/dev/src/server/security.ts:49`, `tests/unit/dev/security.test.ts:16` |
| 4 | Requests exceeding rate limit receive 429 with `Retry-After` header | ✓ VERIFIED | `packages/dev/src/server/app.ts:83`, `packages/dev/src/server/app.ts:86`, `packages/dev/src/server/app.ts:89`, `tests/unit/dev/rate-limiter.test.ts:31` |
| 5 | Request body size is bounded by `Bun.serve` `maxRequestBodySize` | ✓ VERIFIED | `packages/dev/src/server/app.ts:59` |
| 6 | MCP stdio command not in allowlist is rejected with structured error before spawn | ✓ VERIFIED | `packages/core/src/mcp/client.ts:38`, `packages/core/src/mcp/security.ts:21`, `tests/unit/mcp/security.test.ts:29` |
| 7 | MCP http/sse URL host not in allowlist is rejected with structured error | ✓ VERIFIED | `packages/core/src/mcp/client.ts:49`, `packages/core/src/mcp/security.ts:52`, `tests/unit/mcp/security.test.ts:47` |
| 8 | MCP http/sse URL scheme not in allowlist is rejected with structured error | ✓ VERIFIED | `packages/core/src/mcp/security.ts:45`, `packages/core/src/mcp/security.ts:47`, `tests/unit/mcp/security.test.ts:55` |
| 9 | MCP stdio child process receives only allowlisted env vars plus explicit per-server env | ✓ VERIFIED | `packages/core/src/mcp/stdio-transport.ts:52`, `packages/core/src/mcp/security.ts:64`, `packages/core/src/mcp/security.ts:74`, `tests/unit/mcp/security.test.ts:68` |
| 10 | When no allowlist is configured, commands and URLs pass through unrestricted | ✓ VERIFIED | `packages/core/src/mcp/security.ts:16`, `packages/core/src/mcp/security.ts:43`, `tests/unit/mcp/security.test.ts:33`, `tests/unit/mcp/security.test.ts:59` |
| 11 | CI runs gitleaks secret scan on pull requests to main | ✓ VERIFIED | `.github/workflows/security.yml:4`, `.github/workflows/security.yml:6`, `.github/workflows/security.yml:9`, `.github/workflows/security.yml:16` |
| 12 | CI runs semgrep SAST scan on pull requests to main | ✓ VERIFIED | `.github/workflows/security.yml:4`, `.github/workflows/security.yml:21`, `.github/workflows/security.yml:29` |
| 13 | CI runs dependency audit on pull requests to main | ✓ VERIFIED | `.github/workflows/security.yml:4`, `.github/workflows/security.yml:37`, `.github/workflows/security.yml:48` |
| 14 | Validation checklist documents local commands matching CI behavior | ✓ VERIFIED | `.planning/phases/50-security-hardening-baseline/50-VALIDATION.md:28`, `.planning/phases/50-security-hardening-baseline/50-VALIDATION.md:32`, `.planning/phases/50-security-hardening-baseline/50-VALIDATION.md:57`, `.planning/phases/50-security-hardening-baseline/50-VALIDATION.md:59` |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/dev/src/server/security.ts` | Security config + auth/CORS helpers | ✓ VERIFIED | Exists, 63 lines, exported API present, consumed by server app/tests (`packages/dev/src/server/app.ts:12`, `tests/unit/dev/security.test.ts:2`) |
| `packages/dev/src/server/rate-limiter.ts` | In-memory per-IP sliding-window rate limiter | ✓ VERIFIED | Exists, 48 lines, exported class present, instantiated and checked in app (`packages/dev/src/server/app.ts:13`, `packages/dev/src/server/app.ts:34`, `packages/dev/src/server/app.ts:83`) |
| `packages/dev/src/server/app.ts` | Security controls wired into Bun server | ✓ VERIFIED | Exists, 152 lines, Bun request limits and auth/rate/CORS chain implemented (`packages/dev/src/server/app.ts:59`, `packages/dev/src/server/app.ts:83`, `packages/dev/src/server/app.ts:94`) |
| `tests/unit/dev/security.test.ts` | Auth and CORS tests | ✓ VERIFIED | Exists, 58 lines, covers local bypass, unauthorized 401, and origin matching |
| `tests/unit/dev/rate-limiter.test.ts` | Rate limiter tests | ✓ VERIFIED | Exists, 66 lines, covers allow, reject, retry timing, window reset, cleanup |
| `packages/core/src/mcp/security.ts` | MCP security validation/filtering helpers | ✓ VERIFIED | Exists, 78 lines, exports `MCPSecurityError`, `validateCommand`, `validateUrl`, `filterEnv`; used by client and stdio transport |
| `packages/core/src/mcp/types.ts` | MCP allowlist config fields | ✓ VERIFIED | Exists, 236 lines, includes `allowedCommands`, `allowedHosts`, `allowedSchemes`, `envAllowlist` (`packages/core/src/mcp/types.ts:22`, `packages/core/src/mcp/types.ts:28`) |
| `packages/core/src/mcp/client.ts` | Constructor-time trust-boundary checks | ✓ VERIFIED | Exists, 314 lines, validates stdio commands and http/sse URLs before transport creation |
| `packages/core/src/mcp/stdio-transport.ts` | Filtered env passthrough | ✓ VERIFIED | Exists, 332 lines, `filterEnv` used for spawn env (`packages/core/src/mcp/stdio-transport.ts:52`) |
| `tests/unit/mcp/security.test.ts` | MCP trust-boundary tests | ✓ VERIFIED | Exists, 100 lines, covers deny/pass-through cases and env filtering behavior |
| `.github/workflows/security.yml` | PR security CI workflow | ✓ VERIFIED | Exists, 48 lines, valid YAML and contains gitleaks/semgrep/dependency-audit jobs |
| `.planning/phases/50-security-hardening-baseline/50-VALIDATION.md` | Local+CI validation runbook | ✓ VERIFIED | Exists, 96 lines, includes local command matrix and CI section aligned to workflow |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `packages/dev/src/server/app.ts` | `packages/dev/src/server/security.ts` | `import` + `checkAuth`/`matchOrigin` calls | ✓ WIRED | Import present (`packages/dev/src/server/app.ts:12`), auth called (`packages/dev/src/server/app.ts:94`), CORS matcher called (`packages/dev/src/server/app.ts:66`) |
| `packages/dev/src/server/app.ts` | `packages/dev/src/server/rate-limiter.ts` | `RateLimiter` construction + `check()` in fetch | ✓ WIRED | Import present (`packages/dev/src/server/app.ts:13`), constructor wiring (`packages/dev/src/server/app.ts:34`), enforcement (`packages/dev/src/server/app.ts:83`) |
| `packages/core/src/mcp/client.ts` | `packages/core/src/mcp/security.ts` | `validateCommand`/`validateUrl` before transport | ✓ WIRED | Import present (`packages/core/src/mcp/client.ts:15`), command check (`packages/core/src/mcp/client.ts:38`), URL check (`packages/core/src/mcp/client.ts:49`) |
| `packages/core/src/mcp/client.ts` + `packages/core/src/mcp/stdio-transport.ts` | `packages/core/src/mcp/types.ts` allowlist fields | `envAllowlist` passed from config into env filter | ✓ WIRED | Config field defined (`packages/core/src/mcp/types.ts:23`), forwarded (`packages/core/src/mcp/client.ts:43`), applied in spawn env filtering (`packages/core/src/mcp/stdio-transport.ts:52`) |
| `.github/workflows/security.yml` | GitHub Actions PR pipeline | `on.pull_request` to `main` | ✓ WIRED | Trigger present (`.github/workflows/security.yml:4`), branch scope (`.github/workflows/security.yml:6`) |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
| --- | --- | --- |
| SEC-01 (dev auth + CORS hardening) | ✓ SATISFIED | None |
| SEC-02 (request abuse controls: limits/rate limiting) | ✓ SATISFIED | None |
| SEC-03 (MCP trust boundaries) | ✓ SATISFIED | None |
| SEC-04 (CI security scans) | ✓ SATISFIED | None |
| SEC-05 (validation checklist) | ✓ SATISFIED | None |

Notes: `.planning/REQUIREMENTS.md` currently tracks migration requirements and does not include SEC-01..SEC-05 entries; SEC scope and mapping for this phase are verified from `.planning/ROADMAP.md:417` and plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `packages/dev/src/server/app.ts` | 132 | `console.log` server startup | ℹ️ Info | Operational logging only; not a stub or blocker |
| `packages/dev/src/server/app.ts` | 143 | `console.log` server shutdown | ℹ️ Info | Operational logging only; not a stub or blocker |

### Human Verification Required

None for phase-goal structural verification. Automated checks and wiring checks passed.

### Verification Commands Run

- `bun test tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts tests/unit/mcp/security.test.ts` -> 26 pass, 0 fail
- `bun run build` -> success across workspace packages
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/security.yml')); print('ok')"` -> `ok`
- `grep` checks for wildcard CORS and direct `...process.env` spread -> no matches

### Gaps Summary

No blocking gaps found. All plan-defined must-haves and roadmap success criteria for Phase 50 are implemented, substantive, wired, and supported by targeted tests.

---

_Verified: 2026-03-05T06:16:24Z_
_Verifier: Claude (gsd-verifier)_
