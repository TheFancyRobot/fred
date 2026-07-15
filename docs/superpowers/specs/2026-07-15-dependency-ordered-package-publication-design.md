# Dependency-ordered package publication

## Context

Fred publishes independent-version workspace packages from
`scripts/publish-packages.sh`. The current `packages/*` glob is alphabetical,
so `packages/cli` can publish before `packages/core` even though the stable CLI
requires `@fancyrobot/fred@^2.0.0`. During that interval, a new CLI install can
fail because its stable core dependency is not yet available.

The declaration build already solves the same workspace-ordering problem with
an explicit topological package list and a fallback for unlisted packages.

## Decision

Use the same explicit package order in the publish script:

1. core
2. provider packages
3. BAML, Convex, and HTTP adapters
4. CLI
5. the deprecated dev shim

Extract the existing publication body into a `publish_one` shell function.
Publish listed packages in order, then scan `packages/*` and publish only
unlisted packages. The fallback preserves the current behavior for a new
independent workspace package while requiring an intentional order update when
that package introduces an internal Fred dependency.

Do not change package versions, dependency ranges, dist-tag behavior,
republish tolerance, tag creation, or registry visibility checks.

## Alternatives considered

### Dynamically topologically sort manifests

This would adapt automatically to dependency changes, but adds JSON graph
construction and cycle handling to the irreversible release path. The extra
complexity is not justified while the repository already maintains and relies
on a reviewed explicit order.

### Publish core first and keep the remaining alphabetical glob

This closes the immediate CLI-to-core gap but leaves the dev-to-CLI dependency
and future internal package relationships unprotected.

## Failure behavior

`set -euo pipefail` remains active. Any failed package publication stops the
script before later dependents publish. `--tolerate-republish` continues to make
an interrupted run resumable. Existing prerelease dist-tag and registry
propagation behavior remains unchanged.

Private or missing package directories remain no-ops. A package is published
at most once because the fallback skips every name in the explicit order.

## Validation

Add a package-resolution contract test that:

- reads the explicit order from `scripts/publish-packages.sh`;
- confirms each publishable workspace package appears exactly once after the
  ordered pass and fallback are considered;
- verifies every internal `dependencies`, `optionalDependencies`, and
  `peerDependencies` edge points to a package earlier in the explicit order;
- confirms the script executes the ordered pass before the fallback glob.

Run the focused contract, shell syntax validation, the package-surface tests,
and the complete release gate before requesting an exact-head rereview.

## Success criteria

- Core publishes before every package that requires it.
- CLI publishes before the dev compatibility shim.
- Publication stops before dependents when a prerequisite publish fails.
- Existing alpha/stable tag safety and idempotent recovery are preserved.
- PR #92 returns to green exact-head checks and zero unresolved actionable
  review threads before merge.
