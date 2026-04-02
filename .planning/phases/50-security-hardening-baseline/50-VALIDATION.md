---
phase: 50
slug: security-hardening-baseline
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-04
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none (Bun defaults) |
| **Quick run command** | `bun test tests/unit/dev tests/unit/mcp` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | variable by environment |

---

## Local Validation Commands

Run these commands locally to mirror the hardening controls and CI expectations:

- Auth/CORS checks: `bun test tests/unit/dev/security.test.ts`
- Rate-limiter checks: `bun test tests/unit/dev/rate-limiter.test.ts`
- MCP trust-boundary checks: `bun test tests/unit/mcp/security.test.ts`
- Full security-focused suite: `bun test tests/unit/dev tests/unit/mcp`
- Build verification: `bun run build`
- Full test suite: `bun test`
- CORS wildcard regression check (expect no matches): `grep -r "Access-Control-Allow-Origin.*\*" packages/dev/`
- MCP env spread regression check (expect no matches): `grep -n "\.\.\.process\.env" packages/core/src/mcp/stdio-transport.ts`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 50-01-01 | 01 | 1 | SEC-01 | unit | `bun test tests/unit/dev/security.test.ts` | ✅ | ✅ green |
| 50-01-02 | 01 | 1 | SEC-02 | unit | `bun test tests/unit/dev/rate-limiter.test.ts` | ✅ | ✅ green |
| 50-02-01 | 02 | 1 | SEC-03 | unit | `bun test tests/unit/mcp/security.test.ts` | ✅ | ✅ green |
| 50-03-01 | 03 | 2 | SEC-04 | ci-config + syntax | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/security.yml'))"` | ✅ | ✅ green |
| 50-03-02 | 03 | 2 | SEC-05 | documentation + verification | `bun test && bun run build` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## CI Validation

Security CI is defined in `.github/workflows/security.yml` and triggers on `pull_request` to `main`.

- `gitleaks` job: runs `gitleaks/gitleaks-action@v2` on full checkout history (`fetch-depth: 0`) to scan for committed secrets.
- `semgrep` job: runs `semgrep scan --config auto --severity ERROR --error --json --output semgrep-results.json .` and uploads the JSON report artifact.
- `dependency-audit` job: installs workspace dependencies with Bun and runs `bun audit --audit-level=high` to fail on high/critical advisories.

Together these enforce SEC-04 in PR CI and provide actionable security scan output.

---

## Wave 0 Requirements

- [x] `tests/unit/dev/security.test.ts` — auth and CORS controls covered
- [x] `tests/unit/dev/rate-limiter.test.ts` — request-abuse and 429 behavior covered
- [x] `tests/unit/mcp/security.test.ts` — command/url allowlists and env filtering covered

*Wave 0 security tests are now implemented and verified green.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Validation checklist runbook | SEC-05 | Documentation review | Verify docs/ checklist has local + CI commands with expected outputs |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or explicit documentation verification
- [x] Sampling continuity maintained across plans 50-01, 50-02, and 50-03
- [x] Wave 0 references resolved with implemented security tests
- [x] No watch-mode flags in validation commands
- [x] Full-suite and build verification executed (`bun test && bun run build`)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
