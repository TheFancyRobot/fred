import { describe, expect, test } from 'bun:test';
import { handleInitCommand } from '../../src/commands/init';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createCapturingIO() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      stdout: (msg: string) => output.push(msg),
      stderr: (msg: string) => errors.push(msg),
    },
    output,
    errors,
  };
}

/**
 * Tracks files "written" during the test.
 */
function createMockFS(existingFiles: Set<string> = new Set()) {
  const written = new Map<string, string>();

  return {
    existsSync: (path: string) => existingFiles.has(path),
    writeFile: async (path: string, content: string) => {
      written.set(path, content);
    },
    written,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('init command', () => {
  test('creates fred.config.ts in fresh directory', async () => {
    const { io, output } = createCapturingIO();
    const fs = createMockFS();

    const exitCode = await handleInitCommand([], {}, {
      io,
      writeFile: fs.writeFile,
      existsSync: fs.existsSync,
      cwd: () => '/project',
    });

    expect(exitCode).toBe(0);
    const out = output.join('\n');
    expect(out).toContain('create');
    expect(out).toContain('fred.config.ts');
    expect(out).toContain('Fred project initialized');
    expect(out).toContain('fred chat');

    // File was written
    expect(fs.written.has('/project/fred.config.ts')).toBe(true);
  });

  test('skips existing fred.config.ts without overwriting', async () => {
    const { io, output } = createCapturingIO();
    const fs = createMockFS(new Set(['/project/fred.config.ts']));

    const exitCode = await handleInitCommand([], {}, {
      io,
      writeFile: fs.writeFile,
      existsSync: fs.existsSync,
      cwd: () => '/project',
    });

    expect(exitCode).toBe(0);
    const out = output.join('\n');
    expect(out).toContain('skip');
    expect(out).toContain('fred.config.ts');
    expect(out).toContain('already exists');

    // File was NOT written (no overwrite)
    expect(fs.written.has('/project/fred.config.ts')).toBe(false);
  });

  test('still shows success summary when files are skipped', async () => {
    const { io, output } = createCapturingIO();
    const fs = createMockFS(new Set(['/project/fred.config.ts']));

    const exitCode = await handleInitCommand([], {}, {
      io,
      writeFile: fs.writeFile,
      existsSync: fs.existsSync,
      cwd: () => '/project',
    });

    expect(exitCode).toBe(0);
    const out = output.join('\n');
    expect(out).toContain('Fred project initialized');
    expect(out).toContain('fred chat');
  });

  test('write failure returns exit code 1 with error message', async () => {
    const { io, output, errors } = createCapturingIO();

    const exitCode = await handleInitCommand([], {}, {
      io,
      writeFile: async () => {
        throw new Error('EACCES: permission denied');
      },
      existsSync: () => false,
      cwd: () => '/readonly',
    });

    expect(exitCode).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('EACCES');
    expect(err).toContain('permission denied');
  });

  test('created config content contains expected agent definition', async () => {
    const { io } = createCapturingIO();
    const fs = createMockFS();

    await handleInitCommand([], {}, {
      io,
      writeFile: fs.writeFile,
      existsSync: fs.existsSync,
      cwd: () => '/project',
    });

    const content = fs.written.get('/project/fred.config.ts') ?? '';

    // Verify key config elements are present
    expect(content).toContain("id: 'assistant'");
    expect(content).toContain("platform: 'openai'");
    expect(content).toContain("model: 'gpt-4o-mini'");
    expect(content).toContain("tools: ['calculator']");
    expect(content).toContain('FrameworkConfig');
    expect(content).toContain('export default config');
  });
});
