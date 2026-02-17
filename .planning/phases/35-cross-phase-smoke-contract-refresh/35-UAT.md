---
status: complete
phase: 35-cross-phase-smoke-contract-refresh
source: 35-01-SUMMARY.md, 35-02-SUMMARY.md, 35-03-SUMMARY.md
started: 2026-02-15T06:52:08Z
updated: 2026-02-15T06:55:05Z
---

## Current Test

[testing complete]

## Tests

### 1. Consolidated Smoke Gate Command
expected: Running `bun run test:phase35:smoke` executes launch, streaming, TUI session, and CLI session smoke checks in one run and prints one consolidated verdict.
result: pass

### 2. Stale Contract Diagnostic Clarity
expected: If a smoke contract drifts, output should label it as `STALE_CONTRACT` with actionable remediation hints rather than an opaque runtime type error.
result: pass

### 3. Machine Evidence Artifact
expected: After a smoke run, `.planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json` contains per-check command, exit code, channel, decisive lines, and linkage entries.
result: pass

### 4. Requirement Traceability Companion
expected: `.planning/phases/35-cross-phase-smoke-contract-refresh/35-AUDIT-EVIDENCE.md` maps `TUI-08` and `SESS-01..SESS-07` to concrete smoke checks and points to JSON evidence fields.
result: pass

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
