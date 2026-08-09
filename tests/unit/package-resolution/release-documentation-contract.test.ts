import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfigFileTextToJson } from "typescript";

type PackageManifest = {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
};

type BunLock = {
  workspaces: Record<string, PackageManifest>;
  packages: Record<string, readonly [string, ...unknown[]]>;
};

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const MIGRATION_PATH = join(REPO_ROOT, "MIGRATION.md");
const ROOT_README_PATH = join(REPO_ROOT, "README.md");
const STRUCT_HANDOFF_PATH = join(
  REPO_ROOT,
  "docs/struct-provider-connections-handoff.md",
);
const LOCK_PATH = join(REPO_ROOT, "bun.lock");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");
const PACKAGE_DIRS = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(PACKAGES_ROOT, entry.name, "package.json")),
  )
  .map((entry) => entry.name)
  .sort();

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(
    readFileSync(join(PACKAGES_ROOT, packageDir, "package.json"), "utf8"),
  ) as PackageManifest;
}

function readBunLock(): BunLock {
  const parsed = parseConfigFileTextToJson(
    LOCK_PATH,
    readFileSync(LOCK_PATH, "utf8"),
  );
  if (parsed.error)
    throw new Error(`Unable to parse bun.lock: TS${parsed.error.code}`);
  return parsed.config as BunLock;
}

function matrixRow(document: string, packageName: string): string {
  const row = document
    .split("\n")
    .find(
      (line) =>
        line.startsWith(`| \`${packageName}\` |`) ||
        line.startsWith(`| [${packageName}](`),
    );
  if (!row)
    throw new Error(`Missing documentation matrix row for ${packageName}`);
  return row;
}

function documentedPeer(peerName: string, range: string): string {
  if (peerName === "@fancyrobot/fred") return `Fred \`${range}\``;
  if (peerName === "@fancyrobot/fred-cli") return `CLI \`${range}\``;
  return `\`${peerName} ${range}\``;
}

function installVersion(command: string, packageName: string): string {
  const prefix = `${packageName}@`;
  const token = command.split(/\s+/).find((part) => part.startsWith(prefix));
  if (!token) throw new Error(`Missing ${packageName} from install command`);
  return token.slice(prefix.length);
}

function minimumVersion(range: string): string {
  const match = range.match(/^[~^]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (!match) throw new Error(`Unsupported install range: ${range}`);
  return match[1]!;
}

function expectInstallBlockMatches(
  block: string,
  selectedPackages: readonly PackageManifest[],
): void {
  for (const manifest of selectedPackages) {
    expect(installVersion(block, manifest.name)).toBe(manifest.version);
    for (const [peerName, range] of Object.entries(
      manifest.peerDependencies ?? {},
    )) {
      const installRange = installVersion(block, peerName);
      const version = peerName.startsWith("@fancyrobot/")
        ? installRange
        : minimumVersion(installRange);
      expect(Bun.semver.satisfies(version, range)).toBe(true);
    }
  }
}

function bashBlockUnderHeading(document: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const start = document.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${heading} section`);
  const nextHeading = document.indexOf("\n## ", start + marker.length);
  const section = document.slice(
    start,
    nextHeading < 0 ? undefined : nextHeading,
  );
  const block = section.match(/```bash\n([\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error(`Missing bash command under ${heading}`);
  return block;
}

describe("release documentation contract", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const rootReadme = readFileSync(ROOT_README_PATH, "utf8");
  const lock = readBunLock();

  test("canonical matrices track every independent package version and peer range", () => {
    for (const packageDir of PACKAGE_DIRS) {
      const manifest = readManifest(packageDir);
      const row = matrixRow(migration, manifest.name);
      const rootRow = matrixRow(rootReadme, manifest.name);

      expect(row).toContain(`| \`${manifest.version}\` |`);
      expect(rootRow).toContain(`| \`${manifest.version}\` |`);

      for (const [peerName, range] of Object.entries(
        manifest.peerDependencies ?? {},
      )) {
        expect(row).toContain(documentedPeer(peerName, range));
      }
    }
  });

  test("package README exact Fred pins track current manifest versions", () => {
    const manifests = PACKAGE_DIRS.map((packageDir) =>
      readManifest(packageDir),
    );
    const manifestsByName = new Map(
      manifests.map((manifest) => [manifest.name, manifest]),
    );
    const exactFredPin =
      /(@fancyrobot\/[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;

    for (const packageDir of PACKAGE_DIRS) {
      const readmePath = join(PACKAGES_ROOT, packageDir, "README.md");
      if (!existsSync(readmePath)) continue;
      const packageReadme = readFileSync(readmePath, "utf8");

      for (const match of packageReadme.matchAll(exactFredPin)) {
        const manifest = manifestsByName.get(match[1]!);
        if (!manifest) throw new Error(`Unknown Fred package pin: ${match[1]}`);
        expect(match[2]).toBe(manifest.version);
      }
    }
  });

  test("Fred Convex install guidance tracks the enforced manifest peer floor", () => {
    const manifest = readManifest("fred-convex");
    const convexPeer = manifest.peerDependencies?.convex;
    if (!convexPeer) throw new Error("Missing Fred Convex peer dependency");
    const packageReadme = readFileSync(
      join(REPO_ROOT, "packages", "fred-convex", "README.md"),
      "utf8",
    );
    const installBlock = bashBlockUnderHeading(packageReadme, "Installation");

    expect(matrixRow(migration, manifest.name)).toContain(
      `\`convex ${convexPeer}\``,
    );
    expect(installBlock).toContain(`convex@${convexPeer}`);
  });

  test("workspace lock metadata tracks every package manifest", () => {
    for (const packageDir of PACKAGE_DIRS) {
      const manifest = readManifest(packageDir);
      const workspace = lock.workspaces[`packages/${packageDir}`];
      if (!workspace)
        throw new Error(`Missing lock workspace for ${manifest.name}`);

      expect(workspace.name).toBe(manifest.name);
      expect(workspace.version).toBe(manifest.version);
      expect(workspace.peerDependencies ?? {}).toEqual(
        manifest.peerDependencies ?? {},
      );
    }
  });

  test("workspace lock validates the Effect floor required by platform consumers", () => {
    const effectRanges = new Set(
      PACKAGE_DIRS.map((packageDir) => readManifest(packageDir))
        .filter(
          (manifest) =>
            manifest.peerDependencies?.["@effect/platform"] !== undefined,
        )
        .map((manifest) => manifest.peerDependencies?.effect)
        .filter((range): range is string => range !== undefined),
    );

    expect(effectRanges.size).toBe(1);
    const [range] = effectRanges;
    if (!range?.startsWith("^"))
      throw new Error(`Unsupported Effect peer range: ${range}`);
    const expectedResolution = `effect@${range.slice(1)}`;
    const effectResolutions = Object.values(lock.packages)
      .map(([packageId]) => packageId)
      .filter((packageId) => packageId.startsWith("effect@"));

    expect(lock.packages.effect?.[0]).toBe(expectedResolution);
    expect(effectResolutions).toEqual([expectedResolution]);
  });

  test("root quick-start install guidance tracks every selected package peer contract", () => {
    const selectedPackages = [
      readManifest("core"),
      readManifest("provider-openrouter"),
    ];
    const block = bashBlockUnderHeading(rootReadme, "Quick Start");

    expectInstallBlockMatches(block, selectedPackages);
  });

  test("migration install candidate tracks every selected package peer contract", () => {
    const selectedPackages = [
      readManifest("core"),
      readManifest("fred-http"),
      readManifest("provider-minimax"),
    ];
    const block = bashBlockUnderHeading(
      migration,
      "Package compatibility matrix",
    );

    expectInstallBlockMatches(block, selectedPackages);
  });

  test("Struct handoff uses canonical provider IDs instead of package names", async () => {
    const handoff = readFileSync(STRUCT_HANDOFF_PATH, "utf8");
    const providers = {
      openai: "@fancyrobot/fred-openai",
      anthropic: "@fancyrobot/fred-anthropic",
      google: "@fancyrobot/fred-google",
      groq: "@fancyrobot/fred-groq",
      minimax: "@fancyrobot/fred-minimax",
      openrouter: "@fancyrobot/fred-openrouter",
    };

    for (const [providerId, packageName] of Object.entries(providers)) {
      const factory = (await import(packageName)).default;
      expect(factory.id).toBe(providerId);
      expect(handoff).toContain(`| \`${providerId}\` | \`${packageName}\` |`);
    }
    expect(handoff).toContain("never persist it as a provider ID");
  });
});
