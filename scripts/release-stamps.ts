#!/usr/bin/env bun
/**
 * Release version-stamp synchronization.
 *
 * `changeset version` bumps package manifests but cannot carry the version
 * stamps that the release-documentation and publish-surface contract tests
 * enforce. This script detects (--check) or repairs (--fix) that drift:
 *
 *   1. tests/unit/package-resolution/public-api-inventory.json
 *      every entry's `version` tracks its packageDir manifest (0.0.0 -> 1.0.0).
 *   2. MIGRATION.md + root README.md matrix rows
 *      the version cell of every package row tracks the manifest.
 *   3. Exact pins `@fancyrobot/<pkg>@<semver>` in the root README and every
 *      package README (install blocks included) track the pinned package's
 *      manifest version.
 *
 * Peer RANGES (e.g. `effect@^3.21.5`) are intentionally NOT rewritten: they
 * change only through deliberate manifest edits, and the contract tests fail
 * on drift — resolve those by hand.
 *
 * Usage:
 *   bun scripts/release-stamps.ts --check   # exit 1 with a drift report
 *   bun scripts/release-stamps.ts --fix     # rewrite the stamps
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");
const INVENTORY_PATH = join(
  REPO_ROOT,
  "tests/unit/package-resolution/public-api-inventory.json",
);
const MIGRATION_PATH = join(REPO_ROOT, "MIGRATION.md");
const ROOT_README_PATH = join(REPO_ROOT, "README.md");
const EXACT_PIN =
  /(@fancyrobot\/[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;
const MATRIX_NAME_CELL =
  /^`(@fancyrobot\/[a-z0-9-]+)`$|^\[@fancyrobot\/([a-z0-9-]+)\]\(/;

const mode = process.argv.includes("--fix")
  ? "fix"
  : process.argv.includes("--check")
    ? "check"
    : null;
if (!mode) {
  console.error("usage: bun scripts/release-stamps.ts --check | --fix");
  process.exit(2);
}

type Manifest = { name: string; version: string; effectiveVersion: string };

const packageDirs = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(PACKAGES_ROOT, entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

const manifestByDir = new Map<string, Manifest>();
const manifestByName = new Map<string, Manifest>();
for (const dir of packageDirs) {
  const manifest = JSON.parse(
    readFileSync(join(PACKAGES_ROOT, dir, "package.json"), "utf8"),
  ) as { name: string; version: string };
  const entry: Manifest = {
    name: manifest.name,
    version: manifest.version,
    effectiveVersion:
      manifest.version === "0.0.0" ? "1.0.0" : manifest.version,
  };
  manifestByDir.set(dir, entry);
  manifestByName.set(manifest.name, entry);
}

const drifts: string[] = [];
const fixes: string[] = [];
const manual: string[] = [];
const report = (file: string, message: string) => {
  drifts.push(`${file}: ${message}`);
  if (mode === "fix") fixes.push(`${file}: ${message}`);
};

/** Rewrite every exact `@fancyrobot/pkg@semver` pin that drifted. */
function syncExactPins(path: string, content: string, label: string): string {
  let touched = 0;
  const updated = content.replace(EXACT_PIN, (pin, name, version) => {
    const manifest = manifestByName.get(name);
    if (!manifest || manifest.effectiveVersion === version) return pin;
    touched += 1;
    report(label, `${pin} -> ${name}@${manifest.effectiveVersion}`);
    return `${name}@${manifest.effectiveVersion}`;
  });
  return touched > 0 ? updated : content;
}

/** Rewrite the version cell of every drifted matrix row. */
function syncMatrixRows(content: string, label: string): string {
  const lines = content.split("\n");
  let touched = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    // Row shape: | <name cell> | <version cell> | <peer cells...> |  (the
    // split leaves an empty string at both ends, hence slice below).
    const nameMatch = cells[1]?.match(MATRIX_NAME_CELL);
    if (!nameMatch || cells.length < 4) continue;
    const name = `@fancyrobot/${nameMatch[1] ?? nameMatch[2]}`;
    const manifest = manifestByName.get(name);
    if (!manifest) continue;
    const versionCell = `\`${manifest.effectiveVersion}\``;
    if (cells[2] === versionCell) continue;
    touched += 1;
    report(label, `matrix row for ${name}: ${cells[2]} -> ${versionCell}`);
    if (mode === "fix") {
      cells[2] = versionCell;
      lines[i] = `| ${cells.slice(1, -1).join(" | ")} |`;
    }
  }
  return touched > 0 ? lines.join("\n") : content;
}

// --- 1. public API inventory -------------------------------------------------
const inventory = JSON.parse(
  readFileSync(INVENTORY_PATH, "utf8"),
) as Array<{ packageDir: string; version: string }>;
let inventoryTouched = false;
for (const entry of inventory) {
  const resolved = manifestByDir.get(entry.packageDir);
  if (!resolved) continue;
  if (entry.version !== resolved.effectiveVersion) {
    report(
      "tests/unit/package-resolution/public-api-inventory.json",
      `${entry.packageDir} entry version ${entry.version} -> ${resolved.effectiveVersion}`,
    );
    if (mode === "fix") {
      entry.version = resolved.effectiveVersion;
      inventoryTouched = true;
    }
  }
}
if (mode === "fix" && inventoryTouched) {
  writeFileSync(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`);
}

// --- 2 + 3. documentation stamps --------------------------------------------
const docFiles: Array<{ path: string; label: string }> = [
  { path: MIGRATION_PATH, label: "MIGRATION.md" },
  { path: ROOT_README_PATH, label: "README.md" },
  ...packageDirs
    .map((dir) => ({
      path: join(PACKAGES_ROOT, dir, "README.md"),
      label: `packages/${dir}/README.md`,
    }))
    .filter((doc) => existsSync(doc.path)),
];
for (const doc of docFiles) {
  const content = readFileSync(doc.path, "utf8");
  let updated = syncMatrixRows(content, doc.label);
  updated = syncExactPins(doc.path, updated, doc.label);
  if (mode === "fix" && updated !== content) writeFileSync(doc.path, updated);
}

// --- manual follow-ups the tool cannot infer ---------------------------------
const migration = readFileSync(MIGRATION_PATH, "utf8");
for (const manifest of manifestByName.values()) {
  const plain = `| \`${manifest.name}\` |`;
  const linked = `| [${manifest.name}](`;
  if (!migration.includes(plain) && !migration.includes(linked)) {
    manual.push(
      `MIGRATION.md has no matrix row for ${manifest.name} — add one (release-documentation contract throws otherwise).`,
    );
  }
}

// --- report ------------------------------------------------------------------
if (mode === "check") {
  if (drifts.length === 0 && manual.length === 0) {
    console.log("release stamps: OK, no drift");
    process.exit(0);
  }
  for (const drift of drifts) console.error(`drift: ${drift}`);
  for (const item of manual) console.error(`manual: ${item}`);
  console.error(
    `\n${drifts.length} drifted stamp(s), ${manual.length} manual item(s). ` +
      "Run `bun run ci:sync-release-stamps` to repair the stamps automatically.",
  );
  process.exit(1);
}

for (const fix of fixes) console.log(`fixed: ${fix}`);
for (const item of manual) console.warn(`manual: ${item}`);
console.log(
  fixes.length > 0
    ? `release stamps: ${fixes.length} stamp(s) updated`
    : "release stamps: already in sync",
);
