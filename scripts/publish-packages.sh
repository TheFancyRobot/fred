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

# Package manifests publish types from dist/, so direct release invocations
# must not rely on declaration artifacts left by an earlier command.
bash scripts/build-declarations.sh

# Publish in dependency order so a newly released dependent never becomes
# visible before the Fred package version required by its manifest. This
# mirrors the declaration-build order. New independent packages fall through
# to the glob below; packages with Fred dependencies must be added here.
ORDERED_PACKAGES="core fred-postgres provider-anthropic provider-google provider-groq provider-minimax provider-openai provider-openrouter fred-baml fred-convex fred-http cli dev"

publish_one() {
  local dir=$1
  local name
  local version
  if [ ! -f "$dir/package.json" ]; then
    return 0
  fi
  if grep -q '"private"[[:space:]]*:[[:space:]]*true' "$dir/package.json"; then
    echo "Skipping private package $dir"
    return 0
  fi
  name=$(bun -e "console.log(require('./${dir}/package.json').name)")
  version=$(bun -e "console.log(require('./${dir}/package.json').version)")
  # ${TAG_ARGS[@]+...} keeps `set -u` happy on bash 3.x when the array is empty
  (cd "$dir" && bun publish --tolerate-republish ${TAG_ARGS[@]+"${TAG_ARGS[@]}"})
  PUBLISHED_PKGS+=("${name}@${version}")
}

for name in $ORDERED_PACKAGES; do
  publish_one "packages/$name"
done

for dir in packages/*; do
  case " $ORDERED_PACKAGES " in
    *" $(basename "$dir") "*) continue ;;
  esac
  publish_one "$dir"
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
# ${PUBLISHED_PKGS[@]+...} keeps `set -u` happy on bash 3.x (macOS system
# bash 3.2) when the array is empty -- e.g. every package is private. An
# unbound-variable exit here would contradict this check's never-fail intent.
MAX_ATTEMPTS=6
for entry in "${PUBLISHED_PKGS[@]+"${PUBLISHED_PKGS[@]}"}"; do
  name=${entry%@*}
  version=${entry##*@}
  encoded=${name/\//%2f}
  visible=0
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    # Version-specific endpoint returns the single version's document (200)
    # or a direct 404 while it is not yet visible -- no need to download the
    # full package metadata and inspect every version.
    if bun -e "
      const res = await fetch('https://registry.npmjs.org/${encoded}/${version}');
      process.exit(res.ok ? 0 : 1);
    " >/dev/null 2>&1; then
      visible=1
      break
    fi
    # Don't sleep after the final attempt -- nothing polls again after it.
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
      sleep 5
    fi
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
