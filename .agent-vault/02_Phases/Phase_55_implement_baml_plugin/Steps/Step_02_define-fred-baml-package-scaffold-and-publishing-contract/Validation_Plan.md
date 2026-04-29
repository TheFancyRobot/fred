# Validation Plan

## Commands

- `bun install` after adding package/dependencies.
- `bun run build` or targeted `bun run --filter './packages/fred-baml' build` once a build script exists.
- `bun test packages/fred-baml` or chosen test path once package tests exist.
- `bunx tsc --noEmit` if TypeScript exports are touched.

## Manual Checks

- `packages/fred-baml/package.json` uses `@fancyrobot/fred-baml` and public publish config.
- No package import requires a generated consumer `baml_client` at module import time.
- Public API names match PHASE-55 unless deliberately renamed with a decision.

## Pass Criteria

The package can be imported in a trivial TypeScript file without a user BAML project and without invoking generation.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract|02]]
