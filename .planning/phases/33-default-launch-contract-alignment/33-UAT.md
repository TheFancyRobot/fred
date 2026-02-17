---
status: diagnosed
phase: 33-default-launch-contract-alignment
source: 33-01-SUMMARY.md, 33-02-SUMMARY.md, 33-03-SUMMARY.md
started: 2026-02-15T00:11:30Z
updated: 2026-02-15T00:20:09Z
---

## Current Test

[testing complete]

## Tests

### 1. Bare `fred` launches interactive chooser in TTY
expected: Running `fred` with no arguments in a real TTY opens the interactive TUI startup chooser instead of printing help or exiting.
result: pass

### 2. `fred chat` primary-entry hierarchy with `fred`/`fred tui` parity aliases
expected: In TTY mode, `fred chat` is the primary interactive TUI entrypoint, and both `fred` no-args and `fred tui` behave as parity aliases of that same chat launch path.
result: issue
reported: "yes, but `fred chat` should be the primary way to open the interactive tui"
severity: minor

### 3. Non-TTY fallback parity across launch entrypoints
expected: In non-interactive mode, `fred`, `fred chat`, and `fred tui` provide consistent fallback guidance/output contract.
result: pass

### 4. Startup chooser default and Enter behavior
expected: Startup chooser defaults to Start new session and pressing Enter starts a new session with composer ready for typing.
result: pass

### 5. Resume flow requires sidebar confirmation
expected: Choosing Resume previous session first hands off to sidebar selection; transcript restore and input focus happen after sidebar confirmation.
result: pass

### 6. No-config relaunch persistence works
expected: Without explicit config, a created chat session persists (sqlite fallback) and can be resumed after restarting `fred`.
result: pass

## Summary

total: 6
passed: 5
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "In TTY mode, `fred chat` is the primary interactive TUI entrypoint, and `fred` no-args / `fred tui` are parity aliases of that same launch contract."
  status: failed
  reason: "User reported: yes, but `fred chat` should be the primary way to open the interactive tui"
  severity: minor
  test: 2
  root_cause: "Phase 33 acceptance artifacts define launch parity as `fred` vs `fred tui`, while runtime already uses `fred chat` as canonical interactive entrypoint, creating a contract-language mismatch in UAT."
  artifacts:
    - path: ".planning/phases/33-default-launch-contract-alignment/33-UAT.md"
      issue: "Test 2 expected parity between `fred` and `fred tui` but does not encode `fred chat` primary-entry contract."
    - path: ".planning/ROADMAP.md"
      issue: "Phase 33 goal/success criteria emphasize `fred` and `fred tui` equivalence; `fred chat` primacy is implicit."
    - path: ".planning/phases/33-default-launch-contract-alignment/33-03-SUMMARY.md"
      issue: "Final acceptance text records no-args and `tui` parity approval without explicit `fred chat` primary contract wording."
    - path: "tests/unit/cli/phase33-launch-contract-smoke.test.ts"
      issue: "Launch parity assertions cover no-args and `tui` but not explicit canonical-entry hierarchy assertion."
    - path: "packages/cli/src/index.ts"
      issue: "Routing already defaults to `chat` (`args[0] || 'chat'`), confirming this is not runtime behavior breakage."
  missing:
    - "Update Phase 33 UAT wording so contract states `fred chat` is primary interactive entrypoint and `fred`/`fred tui` are parity aliases."
    - "Update Phase 33 goal/success-criteria language in `.planning/ROADMAP.md` to explicitly encode `fred chat` primacy."
    - "Update acceptance narrative in `.planning/phases/33-default-launch-contract-alignment/33-03-SUMMARY.md` to record the approved hierarchy (`chat` primary, others aliases)."
    - "Refresh smoke assertion naming/coverage in `tests/unit/cli/phase33-launch-contract-smoke.test.ts` to explicitly verify the primary-entry hierarchy contract."
  debug_session: ".planning/debug/fred-chat-primary-open-tui.md"
