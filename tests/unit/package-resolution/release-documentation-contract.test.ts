import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type PackageManifest = {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
};

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const MIGRATION_PATH = join(REPO_ROOT, 'MIGRATION.md');
const ROOT_README_PATH = join(REPO_ROOT, 'README.md');
const PACKAGE_DIRS = [
  'core',
  'cli',
  'dev',
  'fred-http',
  'fred-baml',
  'fred-convex',
  'provider-anthropic',
  'provider-google',
  'provider-groq',
  'provider-minimax',
  'provider-openai',
  'provider-openrouter',
] as const;

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', packageDir, 'package.json'), 'utf8'),
  ) as PackageManifest;
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

describe('release documentation contract', () => {
  const migration = readFileSync(MIGRATION_PATH, 'utf8');
  const rootReadme = readFileSync(ROOT_README_PATH, 'utf8');

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
    const packageReadme = readFileSync(
      join(REPO_ROOT, 'packages', 'fred-convex', 'README.md'),
      'utf8',
    );

    expect(convexPeer).toBe('^1.42.1');
    expect(matrixRow(migration, manifest.name)).toContain(`\`convex ${convexPeer}\``);
    expect(packageReadme).toContain(`convex@${convexPeer}`);
  });
});
