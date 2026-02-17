# Phase 35 Audit Rerun Evidence

## Final verdict and timestamp

- Final verdict: **PASS**
- Timestamp (UTC): 2026-02-15T06:42:00Z
- Source artifact: `.planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json`
- `overallExitCode`: `0`
- Channels: `OK` (no `STALE_CONTRACT`, no `SMOKE_FAILURE`)

## Cross-phase linkage

| Phase linkage | Smoke check id | Evidence fields | Suite |
| --- | --- | --- | --- |
| Phase 27 launch parity | `phase27-smoke` | `checks[].exitCode`, `checks[].decisiveLines`, `checks[].channel` | `tests/unit/cli/phase27-smoke.test.ts` |
| Phase 28 streaming boot/flow | `phase28-streaming-smoke` | `checks[].exitCode`, `checks[].decisiveLines`, `checks[].channel` | `tests/unit/cli/phase28-streaming-smoke.test.ts` |
| Phase 29 session baseline (TUI) | `session-state` | `checks[].exitCode`, `checks[].decisiveLines`, `linkage.phase29_tui.covers` | `tests/unit/cli/tui/session-state.test.ts` |
| Phase 29 session baseline (CLI) | `session-commands` | `checks[].exitCode`, `checks[].decisiveLines`, `linkage.phase29_cli.covers` | `tests/unit/cli/session-commands.test.ts` |
| Phase 33 launch contract | `phase33-launch-contract-smoke` | `checks[].exitCode`, `checks[].decisiveLines`, `checks[].channel` | `tests/unit/cli/phase33-launch-contract-smoke.test.ts` |
| Phase 35 consolidated rollup | `phase35-rollup` | `overallExitCode`, `checks[].exitCode`, `checks[].decisiveLines` | Integrated bundle command |

## Decisive proof lines and exit code summary

| Check id | Exit code | Decisive proof lines |
| --- | --- | --- |
| `phase27-smoke` | `0` | `0 fail`; `13 pass`; `Ran 13 tests across 1 file.` |
| `phase28-streaming-smoke` | `0` | `0 fail`; `3 pass`; `Ran 3 tests across 1 file.` |
| `phase33-launch-contract-smoke` | `0` | `0 fail`; `7 pass`; `Ran 7 tests across 1 file.` |
| `session-state` | `0` | `0 fail`; `12 pass`; `Ran 12 tests across 1 file.` |
| `session-commands` | `0` | `0 fail`; `5 pass`; `Ran 5 tests across 1 file.` |
| `phase35-rollup` | `0` | `0 fail`; `40 pass`; `Ran 40 tests across 5 files.` |

## STALE_CONTRACT channel status

- Status: **absent**
- Evidence basis: `channels` contains only `OK`; every check reports `channel: "OK"` and `exitCode: 0`.
- Remediation hint if it appears in future reruns: align smoke mocks to `tests/unit/cli/fixtures/fred-smoke-contract.ts` and ensure runtime-required members (`getContextManager`, `SqliteContextStorage`) are exported in all launch/stream smoke suites.

## Requirement traceability

| Requirement ID | Requirement surface | Smoke check linkage | Evidence path(s) |
| --- | --- | --- | --- |
| `TUI-08` | Real-time TUI streaming without regressions | `phase28-streaming-smoke` | `checks[id=phase28-streaming-smoke].exitCode`, `checks[id=phase28-streaming-smoke].decisiveLines`, `checks[id=phase28-streaming-smoke].channel` |
| `SESS-01` | TUI session list metadata | `session-state` | `checks[id=session-state].exitCode`, `linkage.phase29_tui.covers` |
| `SESS-02` | TUI session switch | `session-state` | `checks[id=session-state].exitCode`, `linkage.phase29_tui.covers` |
| `SESS-03` | TUI new session creation | `session-state` | `checks[id=session-state].exitCode`, `linkage.phase29_tui.covers` |
| `SESS-04` | CLI session list (`fred session list`) | `session-commands` | `checks[id=session-commands].exitCode`, `linkage.phase29_cli.covers` |
| `SESS-05` | CLI session transcript (`fred session show`) | `session-commands` | `checks[id=session-commands].exitCode`, `linkage.phase29_cli.covers` |
| `SESS-06` | CLI session export (`fred session export`) | `session-commands` | `checks[id=session-commands].exitCode`, `linkage.phase29_cli.covers` |
| `SESS-07` | CLI session delete (`fred session rm`) | `session-commands` | `checks[id=session-commands].exitCode`, `linkage.phase29_cli.covers` |

## Re-run recipe

```bash
# Consolidated gate (writes refreshed machine evidence)
bun run test:phase35:smoke

# Schema sanity check for audit artifact shape
bun -e "const p='.planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json'; const j=JSON.parse(await Bun.file(p).text()); if (typeof j.overallExitCode !== 'number' || !Array.isArray(j.checks)) throw new Error('missing final evidence fields');"

# Focused proof extraction from this companion file
rg "Final verdict|Cross-phase linkage|STALE_CONTRACT|Re-run recipe|overallExitCode|TUI-08|SESS-01|SESS-07" \
  .planning/phases/35-cross-phase-smoke-contract-refresh/35-AUDIT-EVIDENCE.md
```
