import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseConfigFileTextToJson } from 'typescript';

type PackageManifest = {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
};

type BunLock = {
  workspaces: Record<string, PackageManifest>;
};

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const MIGRATION_PATH = join(REPO_ROOT, 'MIGRATION.md');
const ROOT_README_PATH = join(REPO_ROOT, 'README.md');
const LOCK_PATH = join(REPO_ROOT, 'bun.lock');
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');
const PACKAGE_DIRS = readdirSync(PACKAGES_ROOT, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(PACKAGES_ROOT, entry.name, 'package.json')),
  )
  .map((entry) => entry.name)
  .sort();

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(
    readFileSync(join(PACKAGES_ROOT, packageDir, 'package.json'), 'utf8'),
  ) as PackageManifest;
}

function readBunLock(): BunLock {
  const parsed = parseConfigFileTextToJson(LOCK_PATH, readFileSync(LOCK_PATH, 'utf8'));
  if (parsed.error) throw new Error(`Unable to parse bun.lock: TS${parsed.error.code}`);
  return parsed.config as BunLock;
}

function matrixRow(document: string, packageName: string): string {
  const row = document
    .split('\n')
    .find((line) => line.startsWith(`| \`${packageName}\` |`) || line.startsWith(`| [${packageName}](`));
  if (!row) throw new Error(`Missing documentation matrix row for ${packageName}`);
  return row;
}

function documentedPeer(peerName: string, range: string): string {
  if (peerName === '@fancyrobot/fred') return `Fred \`${range}\``;
  if (peerName === '@fancyrobot/fred-cli') return `CLI \`${range}\``;
  return `\`${peerName} ${range}\``;
}

function installVersion(command: string, packageName: string): string {
  const prefix = `${packageName}@`;
  const token = command.split(/\s+/).find((part) => part.startsWith(prefix));
  if (!token) throw new Error(`Missing ${packageName} from install command`);
  return token.slice(prefix.length);
}

function bashBlockUnderHeading(document: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const start = document.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${heading} section`);
  const nextHeading = document.indexOf('\n## ', start + marker.length);
  const section = document.slice(start, nextHeading < 0 ? undefined : nextHeading);
  const block = section.match(/```bash\n([\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error(`Missing bash command under ${heading}`);
  return block;
}

describe('release documentation contract', () => {
  const migration = readFileSync(MIGRATION_PATH, 'utf8');
  const rootReadme = readFileSync(ROOT_README_PATH, 'utf8');
  const lock = readBunLock();

  test('canonical matrices track every independent package version and peer range', () => {
    for (const packageDir of PACKAGE_DIRS) {
      const manifest = readManifest(packageDir);
      const row = matrixRow(migration, manifest.name);
      const rootRow = matrixRow(rootReadme, manifest.name);

      expect(row).toContain(`| \`${manifest.version}\` |`);
      expect(rootRow).toContain(`| \`${manifest.version}\` |`);

      for (const [peerName, range] of Object.entries(manifest.peerDependencies ?? {})) {
        expect(row).toContain(documentedPeer(peerName, range));
      }
    }
  });

  test('Fred Convex install guidance tracks the enforced manifest peer floor', () => {
    const manifest = readManifest('fred-convex');
    const convexPeer = manifest.peerDependencies?.convex;
    if (!convexPeer) throw new Error('Missing Fred Convex peer dependency');
    const packageReadme = readFileSync(
      join(REPO_ROOT, 'packages', 'fred-convex', 'README.md'),
      'utf8',
    );
    const installBlock = bashBlockUnderHeading(packageReadme, 'Installation');

    expect(matrixRow(migration, manifest.name)).toContain(`\`convex ${convexPeer}\``);
    expect(installBlock).toContain(`convex@${convexPeer}`);
  });

  test('workspace lock metadata tracks every package manifest', () => {
    for (const packageDir of PACKAGE_DIRS) {
      const manifest = readManifest(packageDir);
      const workspace = lock.workspaces[`packages/${packageDir}`];
      if (!workspace) throw new Error(`Missing lock workspace for ${manifest.name}`);

      expect(workspace.name).toBe(manifest.name);
      expect(workspace.version).toBe(manifest.version);
      expect(workspace.peerDependencies ?? {}).toEqual(manifest.peerDependencies ?? {});
    }
  });

  test('root quick-start install guidance tracks every selected package peer contract', () => {
    const selectedPackages = [readManifest('core'), readManifest('provider-openrouter')];
    const block = bashBlockUnderHeading(rootReadme, 'Quick Start');
    const peers = new Map<string, string>();

    for (const manifest of selectedPackages) {
      installVersion(block, manifest.name);
      for (const [peerName, range] of Object.entries(manifest.peerDependencies ?? {})) {
        const existing = peers.get(peerName);
        if (existing && existing !== range) {
          throw new Error(`Conflicting ${peerName} peer ranges: ${existing} and ${range}`);
        }
        peers.set(peerName, range);
      }
    }

    for (const [peerName, range] of peers) {
      const version = installVersion(block, peerName);
      if (peerName.startsWith('@fancyrobot/')) {
        expect(Bun.semver.satisfies(version, range)).toBe(true);
      } else {
        expect(version).toBe(range);
      }
    }
  });
});
