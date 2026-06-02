import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDirs: string[] = [];

describe('fred-http sibling consumption', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports package-name imports from local file dependencies', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fred-http-sibling-'));
    tempDirs.push(tempDir);

    const root = resolve(process.cwd());
    const corePath = resolve(root, 'packages/core');
    const httpPath = resolve(root, 'packages/fred-http');

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fred-http-sibling-fixture',
          private: true,
          type: 'module',
          dependencies: {
            '@fancyrobot/fred': `file:${corePath}`,
            '@fancyrobot/fred-http': `file:${httpPath}`,
          },
        },
        null,
        2
      )
    );

    writeFileSync(
      join(tempDir, 'index.ts'),
      `import { Fred } from '@fancyrobot/fred';
import { createFredHttpApp } from '@fancyrobot/fred-http';

const fred = new Fred();
const app = createFredHttpApp({
  fred,
  security: { requireAuth: false },
  routes: [
    {
      method: 'GET',
      path: '/public/ping',
      visibility: 'public',
      handler: () => new Response('pong', { status: 200 }),
    },
  ],
});

const response = await app.fetch(new Request('http://localhost/public/ping'));
if (response.status !== 200) {
  throw new Error('unexpected status: ' + response.status);
}
const body = await response.text();
if (body !== 'pong') {
  throw new Error('unexpected body: ' + body);
}
process.exit(0);
`
    );

    const install = spawnSync('bun', ['install'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 180_000,
    });
    expect(install.status).toBe(0);

    const run = spawnSync('bun', ['run', 'index.ts'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 180_000,
    });

    expect(run.status).toBe(0);
  }, 240_000);
});
