# Phase 29 Verification Evidence Draft (Task 1 Inputs)

## Deterministic command bundle run

- Command: `bun test tests/unit/core/context/session.test.ts tests/unit/cli/session-commands.test.ts`
  - Exit code: 0
  - Decisive lines: `11 pass`, `0 fail`, `Ran 11 tests across 2 files.`
- Command: `bun test tests/unit/cli/tui/session-state.test.ts tests/unit/cli/tui/session-delete.test.ts tests/unit/cli/tui-layout.test.ts tests/unit/cli/tui-keymap.test.ts tests/unit/cli/tui-app.test.ts`
  - Exit code: 0
  - Decisive lines: `111 pass`, `0 fail`, `Ran 111 tests across 5 files.`

## Requirement to evidence mapping draft (SESS-01..SESS-07)

- `SESS-01` (TUI session list + metadata)
  - Tests: `tests/unit/cli/tui/session-state.test.ts`, `tests/unit/cli/tui-layout.test.ts`, `tests/unit/cli/tui-app.test.ts`
  - Artifacts: `packages/cli/src/tui/state.ts`, `packages/cli/src/tui/layout.ts`, `packages/cli/src/tui/app.ts`
  - Notes: Sidebar rendering and metadata fields covered by deterministic unit/integration assertions.

- `SESS-02` (switch sessions in TUI sidebar)
  - Tests: `tests/unit/cli/tui/session-state.test.ts`, `tests/unit/cli/tui-app.test.ts`
  - Artifacts: `packages/cli/src/tui/state.ts`, `packages/cli/src/tui/session.ts`, `packages/cli/src/tui/keymap.ts`
  - Notes: Selection and session switching behavior has state-level and app-level coverage.

- `SESS-03` (create new session from TUI)
  - Tests: `tests/unit/cli/tui/session-state.test.ts`, `tests/unit/cli/tui-layout.test.ts`, `tests/unit/cli/tui-app.test.ts`
  - Artifacts: `packages/cli/src/tui/state.ts`, `packages/cli/src/tui/layout.ts`, `packages/cli/src/tui/app.ts`
  - Notes: New-session action and chooser flows are covered deterministically.

- `SESS-04` (`fred session list` table + `--json`)
  - Tests: `tests/unit/cli/session-commands.test.ts`
  - Artifacts: `packages/cli/src/commands/session.ts`
  - Notes: Table and JSON output paths are validated.

- `SESS-05` (`fred session show <id>` transcript view)
  - Tests: `tests/unit/cli/session-commands.test.ts`
  - Artifacts: `packages/cli/src/commands/session.ts`
  - Notes: Show command markdown transcript output is validated.

- `SESS-06` (`fred session export <id>` JSON + markdown)
  - Tests: `tests/unit/cli/session-commands.test.ts`, `tests/unit/core/context/session.test.ts`
  - Artifacts: `packages/cli/src/commands/session.ts`, `packages/core/src/context/session.ts`, `packages/core/src/context/manager.ts`
  - Notes: Export command wiring and serializer/formatter behavior are both covered.

- `SESS-07` (`fred session rm <id>`)
  - Tests: `tests/unit/cli/session-commands.test.ts`, `tests/unit/cli/tui/session-delete.test.ts`
  - Artifacts: `packages/cli/src/commands/session.ts`, `packages/cli/src/tui/state.ts`, `packages/cli/src/tui/app.ts`
  - Notes: CLI confirmation path and TUI deletion lifecycle are both covered.

## Gap candidates discovered in Task 1

- None identified from deterministic test bundle output and current requirement-artifact mapping draft.
