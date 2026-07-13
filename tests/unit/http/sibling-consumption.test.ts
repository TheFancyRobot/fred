import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('supports package-name imports from local workspace links without package-manager install', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fred-http-sibling-'));
    tempDirs.push(tempDir);

    const root = resolve(process.cwd());
    const corePath = resolve(root, 'packages/core');
    const httpPath = resolve(root, 'packages/fred-http');
    const scopeDir = join(tempDir, 'node_modules', '@fancyrobot');
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(corePath, join(scopeDir, 'fred'), 'dir');
    symlinkSync(httpPath, join(scopeDir, 'fred-http'), 'dir');

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fred-http-sibling-fixture',
          private: true,
          type: 'module',
        },
        null,
        2
      )
    );

    writeFileSync(
      join(tempDir, 'index.ts'),
      `import { createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

const fred = withHttp(await createFred(), {
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

const server = await fred.server.listen();
const response = await fetch(server.url + '/public/ping');
if (response.status !== 200) {
  throw new Error('unexpected status: ' + response.status);
}
const body = await response.text();
if (body !== 'pong') {
  throw new Error('unexpected body: ' + body);
}
await fred.shutdown();
process.exit(0);
`
    );

    const run = spawnSync('bun', ['run', 'index.ts'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 180_000,
    });

    expect(run.status).toBe(0);
  }, 240_000);
});
