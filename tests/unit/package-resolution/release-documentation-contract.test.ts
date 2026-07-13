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

function installVersion(command: string, packageName: string): string {
  const prefix = `${packageName}@`;
  const token = command.split(/\s+/).find((part) => part.startsWith(prefix));
  if (!token) throw new Error(`Missing ${packageName} from install command`);
  return token.slice(prefix.length);
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

  test('root quick-start install guidance tracks the selected provider peer contract', () => {
    const provider = readManifest('provider-openrouter');
    const block = rootReadme.match(/## Quick Start[\s\S]*?```bash\n([\s\S]*?)\n```/)?.[1];
    if (!block) throw new Error('Missing root README Quick Start install command');

    for (const [peerName, range] of Object.entries(provider.peerDependencies ?? {})) {
      const version = installVersion(block, peerName);
      if (peerName.startsWith('@fancyrobot/')) {
        expect(Bun.semver.satisfies(version, range)).toBe(true);
      } else {
        expect(version).toBe(range);
      }
    }
  });
});
