#!/usr/bin/env bash
# Build TypeScript declarations for every workspace package that defines a
# build:declarations script. Consumer-facing package types point at dist/,
# so declarations must be built before running the test suite (examples
# guard + package-resolution consumer tests typecheck against them).
#
# The repo's tsc is patched by @effect/language-service, whose lint
# diagnostics (warning/message severity) make tsc exit non-zero even with
# zero compiler errors. This wrapper fails only on real `error TS` output
# or unexpected exit codes.
set -uo pipefail

# Explicit topological order: packages/* globs alphabetically, which builds
# `dev` before `cli` even though the final dev compatibility shim re-exports
# CLI declarations. On a clean checkout that leaves no dist/ for the import
# to resolve against. `core` has no sibling dependencies and must come first;
# `dev` depends on `cli`, so it comes last. Any package not listed here still
# gets built, appended at the end, so a new package works without needing
# this list updated unless it introduces a new inter-package dependency.
ORDERED_PACKAGES="core provider-anthropic provider-google provider-groq provider-minimax provider-openai provider-openrouter fred-baml fred-convex fred-http cli dev"

status=0
build_one() {
  local dir=$1
  [ -f "$dir/package.json" ] || return 0
  grep -q '"build:declarations"' "$dir/package.json" || return 0

  echo "==> $dir"
  out=$( (cd "$dir" && rm -f tsconfig.tsbuildinfo && bun run build:declarations) 2>&1 )
  rc=$?

  if echo "$out" | grep -Eq "error TS[0-9]+"; then
    echo "$out" | grep -E "error TS[0-9]+"
    echo "FAILED (compiler errors): $dir"
    status=1
  elif [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
    # 0 = clean; 2 = diagnostics present but outputs generated (language-
    # service warnings). Anything else is a real failure (crash, bad config).
    echo "$out" | tail -20
    echo "FAILED (exit $rc): $dir"
    status=1
  fi
}

for name in $ORDERED_PACKAGES; do
  build_one "packages/$name"
done

for dir in packages/*; do
  case " $ORDERED_PACKAGES " in
    *" $(basename "$dir") "*) continue ;;
  esac
  build_one "$dir"
done

exit $status
