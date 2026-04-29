# Validation Plan

## Required Checks

- Confirm DEC-0127 exists and is linked from PHASE-55.
- Confirm boundary text explicitly says: not CLI-plugin-first, markdown/frontmatter unchanged, BAML additive.
- Confirm later step notes refer to this boundary where relevant.

## Commands

- `bun test tests/unit/core/migration/phase-44-boundary-guard.test.ts` if source changes are made while documenting boundaries.
- `vault_validate target=all` after vault updates.

## Manual Review

- Search the plan for accidental language that says CLI plugins are required for runtime behavior.
- Check that any mention of `plugins[]` is framed as current limitation/rejected seam, not implementation dependency.

## Pass Criteria

A first-day developer can explain where `fred-baml` lives, how it is used, and what it must not change before starting Step 02.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|01]]
