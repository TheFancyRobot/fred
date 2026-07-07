#!/usr/bin/env bash
# Publish all non-private workspace packages, then create changeset git tags.
#
# When changesets pre-release mode is active (.changeset/pre.json exists),
# packages are published under that dist-tag (e.g. `alpha`) so prereleases
# never move the `latest` tag on npm.
set -euo pipefail

TAG_ARGS=()
if [ -f .changeset/pre.json ]; then
  PRE_TAG=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(".changeset/pre.json", "utf8")).tag)')
  echo "Changesets pre mode active: publishing under dist-tag '${PRE_TAG}'"
  TAG_ARGS=(--tag "${PRE_TAG}")
fi

for dir in packages/*; do
  if [ ! -f "$dir/package.json" ]; then
    continue
  fi
  if grep -q '"private"[[:space:]]*:[[:space:]]*true' "$dir/package.json"; then
    echo "Skipping private package $dir"
    continue
  fi
  # ${TAG_ARGS[@]+...} keeps `set -u` happy on bash 3.x when the array is empty
  (cd "$dir" && bun publish --tolerate-republish ${TAG_ARGS[@]+"${TAG_ARGS[@]}"})
done

changeset tag
