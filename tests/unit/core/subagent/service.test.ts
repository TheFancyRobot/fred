import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { Fred } from '../../../../packages/core/src/index';
import { FredLayers, SubagentService } from '../../../../packages/core/src/services';
import { createSubagentExecutionContext, withSubagentExecutionContext } from '../../../../packages/core/src/subagent/context';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('SubagentService', () => {
  test('FredLayers provides SubagentService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SubagentService;
        return yield* service.listSubagents();
      }).pipe(Effect.provide(FredLayers)),
    );

    expect(result).toEqual([]);
  });

  test('Fred subagents can spawn, inspect, list, and destroy', async () => {
    const fred = await Fred.create();

    try {
      const subagent = await fred.subagents.spawn({
        name: 'test-subagent',
        command: process.execPath,
        metadata: { purpose: 'test' },
      });

      expect(subagent.status).toBe('idle');

      const listed = await fred.subagents.list();
      expect(listed.some((entry) => entry.id === subagent.id)).toBe(true);

      const inspected = await fred.subagents.inspect(subagent.id);
      expect(inspected?.name).toBe('test-subagent');
      expect(inspected?.metadata).toEqual({ purpose: 'test' });

      const destroyed = await fred.subagents.destroy(subagent.id);
      expect(destroyed).toBe(true);

      const destroyedState = await fred.subagents.inspect(subagent.id);
      expect(destroyedState?.status).toBe('destroyed');
    } finally {
      await fred.shutdown();
    }
  });

  test('execute captures output and updates execution metadata', async () => {
    const fred = await Fred.create();

    try {
      const subagent = await fred.subagents.spawn({
        name: 'echo-subagent',
        command: process.execPath,
      });

      const result = await fred.subagents.execute(subagent.id, {
        args: ['-e', 'process.stdout.write(process.argv.slice(1).join(","))', 'alpha', 'beta'],
      });

      expect(result.stdout).toBe('alpha,beta');

      const inspected = await fred.subagents.inspect(subagent.id);
      expect(inspected?.status).toBe('idle');
      expect(inspected?.executionCount).toBe(1);
      expect(inspected?.lastExecution?.exitCode).toBe(0);
      expect(inspected?.lastExecution?.stdoutPreview).toBe('alpha,beta');
    } finally {
      await fred.shutdown();
    }
  });

  test('execute does not leak the full parent environment to subagents', async () => {
    const fred = await Fred.create();
    const originalSecret = process.env.TEST_SUBAGENT_SECRET;
    process.env.TEST_SUBAGENT_SECRET = 'top-secret-value';

    try {
      const subagent = await fred.subagents.spawn({
        name: 'env-subagent',
        command: process.execPath,
      });

      const result = await fred.subagents.execute(subagent.id, {
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({ leaked: process.env.TEST_SUBAGENT_SECRET ?? null, hasPath: typeof process.env.PATH === "string" }))',
        ],
      });

      expect(JSON.parse(result.stdout)).toEqual({ leaked: null, hasPath: true });
    } finally {
      if (originalSecret === undefined) {
        delete process.env.TEST_SUBAGENT_SECRET;
      } else {
        process.env.TEST_SUBAGENT_SECRET = originalSecret;
      }
      await fred.shutdown();
    }
  });

  test('destroy terminates a running subagent process', async () => {
    const fred = await Fred.create();

    try {
      const subagent = await fred.subagents.spawn({
        name: 'long-running-subagent',
        command: process.execPath,
      });

      const execution = fred.subagents.execute(subagent.id, {
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 5_000,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const runningState = await fred.subagents.inspect(subagent.id);
      expect(runningState?.status).toBe('running');
      expect(runningState?.currentExecution?.pid).toBeDefined();

      const destroyed = await fred.subagents.destroy(subagent.id);
      expect(destroyed).toBe(true);
      await expect(execution).rejects.toThrow('Failed to execute subagent');

      const destroyedState = await fred.subagents.inspect(subagent.id);
      expect(destroyedState?.status).toBe('destroyed');
    } finally {
      await fred.shutdown();
    }
  });

  test('timeout terminates hung process groups and records timedOut metadata', async () => {
    const fred = await Fred.create();

    try {
      const tempDir = await mkdtemp(join(tmpdir(), 'fred-subagent-'));
      const childPidPath = join(tempDir, 'child.pid');
      const subagent = await fred.subagents.spawn({
        name: 'hanging-subagent',
        command: process.execPath,
      });

      const script = [
        'const fs = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        'fs.writeFileSync(process.argv[1], String(child.pid));',
        'setInterval(() => {}, 1000);',
      ].join(' ');

      await expect(
        fred.subagents.execute(subagent.id, {
          args: ['-e', script, childPidPath],
          timeoutMs: 250,
          terminationGraceMs: 100,
        }),
      ).rejects.toThrow('Failed to execute subagent');

      const childPid = Number((await readFile(childPidPath, 'utf8')).trim());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(isProcessRunning(childPid)).toBe(false);

      const inspected = await fred.subagents.inspect(subagent.id);
      expect(inspected?.status).toBe('failed');
      expect(inspected?.lastExecution?.timedOut).toBe(true);
    } finally {
      await fred.shutdown();
    }
  });

  test('inherits execution deadline from parent context', async () => {
    const fred = await Fred.create();

    try {
      const subagent = await fred.subagents.spawn({
        name: 'deadline-subagent',
        command: process.execPath,
      });

      const startedAt = Date.now();
      await expect(
        withSubagentExecutionContext(
          createSubagentExecutionContext({ timeoutMs: 350, reserveTimeoutMs: 75 }),
          async () =>
            fred.subagents.execute(subagent.id, {
              args: ['-e', 'setInterval(() => {}, 1000)'],
              timeoutMs: 5_000,
              terminationGraceMs: 50,
            }),
        ),
      ).rejects.toThrow('Failed to execute subagent');

      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(1000);

      const inspected = await fred.subagents.inspect(subagent.id);
      expect(inspected?.lastExecution?.timedOut).toBe(true);
    } finally {
      await fred.shutdown();
    }
  });
});
