import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type PackageManifest = {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");
const PUBLISH_SCRIPT_PATH = join(REPO_ROOT, "scripts/publish-packages.sh");
const DECLARATION_SCRIPT_PATH = join(REPO_ROOT, "scripts/build-declarations.sh");

function readPublishOrder(script: string): readonly string[] {
  const match = script.match(/^ORDERED_PACKAGES="([^"]+)"$/m);
  if (!match) throw new Error("Missing ORDERED_PACKAGES in publish script");
  return match[1]!.trim().split(/\s+/);
}

function readPublishablePackages(): ReadonlyMap<string, PackageManifest> {
  const packages = new Map<string, PackageManifest>();
  for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      readFileSync(join(PACKAGES_ROOT, entry.name, "package.json"), "utf8"),
    ) as PackageManifest;
    if (!manifest.private) packages.set(entry.name, manifest);
  }
  return packages;
}

describe("package publication order", () => {
  const script = readFileSync(PUBLISH_SCRIPT_PATH, "utf8");
  const orderedPackageDirs = readPublishOrder(script);
  const publishablePackages = readPublishablePackages();
  const internalNames = new Map(
    [...publishablePackages].map(([dir, manifest]) => [manifest.name, dir]),
  );

  test("publishes every workspace package exactly once", () => {
    expect(new Set(orderedPackageDirs).size).toBe(orderedPackageDirs.length);

    const fallbackPackageDirs = [...publishablePackages.keys()]
      .filter((dir) => !orderedPackageDirs.includes(dir))
      .sort();
    const completeOrder = [...orderedPackageDirs, ...fallbackPackageDirs];

    expect([...completeOrder].sort()).toEqual(
      [...publishablePackages.keys()].sort(),
    );
    expect(new Set(completeOrder).size).toBe(publishablePackages.size);
  });

  test("places every internal dependency before its dependent", () => {
    const orderIndex = new Map(
      orderedPackageDirs.map((dir, index) => [dir, index]),
    );

    for (const [dependentDir, manifest] of publishablePackages) {
      for (const dependencies of [
        manifest.dependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ]) {
        for (const dependencyName of Object.keys(dependencies ?? {})) {
          const dependencyDir = internalNames.get(dependencyName);
          if (!dependencyDir) continue;

          expect(orderIndex.get(dependencyDir)).toBeLessThan(
            orderIndex.get(dependentDir)!,
          );
        }
      }
    }
  });

  test("executes the ordered pass before the fallback glob", () => {
    const orderedPass = script.indexOf("for name in $ORDERED_PACKAGES; do");
    const fallbackPass = script.indexOf("for dir in packages/*; do");

    expect(orderedPass).toBeGreaterThan(-1);
    expect(fallbackPass).toBeGreaterThan(orderedPass);
    expect(script).toContain('publish_one "packages/$name"');
    expect(script).toContain('publish_one "$dir"');
  });
});

describe("declaration build order", () => {
  const script = readFileSync(DECLARATION_SCRIPT_PATH, "utf8");
  const orderedPackageDirs = readPublishOrder(script);
  const orderIndex = new Map(orderedPackageDirs.map((dir, index) => [dir, index]));

  test("builds Fred Postgres declarations before its clean-checkout consumers", () => {
    expect(orderIndex.get("fred-postgres")).toBeLessThan(orderIndex.get("fred-http")!);
    expect(orderIndex.get("fred-postgres")).toBeLessThan(orderIndex.get("cli")!);
  });
});
