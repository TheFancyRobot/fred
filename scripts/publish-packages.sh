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

PUBLISHED_PKGS=()

for dir in packages/*; do
  if [ ! -f "$dir/package.json" ]; then
    continue
  fi
  if grep -q '"private"[[:space:]]*:[[:space:]]*true' "$dir/package.json"; then
    echo "Skipping private package $dir"
    continue
  fi
  name=$(bun -e "console.log(require('./${dir}/package.json').name)")
  version=$(bun -e "console.log(require('./${dir}/package.json').version)")
  # ${TAG_ARGS[@]+...} keeps `set -u` happy on bash 3.x when the array is empty
  (cd "$dir" && bun publish --tolerate-republish ${TAG_ARGS[@]+"${TAG_ARGS[@]}"})
  PUBLISHED_PKGS+=("${name}@${version}")
done

changeset tag

# Sanity check only, not a release gate: brand-new scoped packages can take
# a while to become visible on registry.npmjs.org's GET path after a
# successful publish (the write succeeds immediately; read replicas lag).
# A missing package here does NOT necessarily mean the publish failed --
# `bun publish` above already exits non-zero (failing the script, since
# set -e is on) for real errors. This just surfaces propagation lag instead
# of leaving it to be discovered by a human running `npm view` hours later.
echo ""
echo "Verifying published packages are visible on the registry..."
for entry in "${PUBLISHED_PKGS[@]}"; do
  name=${entry%@*}
  version=${entry##*@}
  encoded=${name/\//%2f}
  visible=0
  for attempt in 1 2 3 4 5 6; do
    if bun -e "
      const res = await fetch('https://registry.npmjs.org/${encoded}');
      if (!res.ok) process.exit(1);
      const data = await res.json();
      process.exit(data.versions && data.versions['${version}'] ? 0 : 1);
    " >/dev/null 2>&1; then
      visible=1
      break
    fi
    sleep 5
  done
  if [ "$visible" -eq 1 ]; then
    echo "  ok    ${entry}"
  else
    echo "  WARN  ${entry} not visible on the registry yet."
    echo "        This is usually npm propagation lag for newly created package names, not a"
    echo "        failed publish (bun publish above would have failed the build otherwise)."
    echo "        Re-check in a few minutes with: npm view ${name} version"
  fi
done
