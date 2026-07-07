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

status=0
for dir in packages/*; do
  [ -f "$dir/package.json" ] || continue
  grep -q '"build:declarations"' "$dir/package.json" || continue

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
done

exit $status
