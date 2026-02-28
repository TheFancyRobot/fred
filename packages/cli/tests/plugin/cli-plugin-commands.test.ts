import { describe, expect, test } from 'bun:test';
import { createPluginCliRuntime } from '../../src/plugin/runtime';
import { renderPluginHelpSection } from '../../src/plugin/help';
import type { RegisteredPluginContributions } from '../../src/plugin/registry';

function makePlugin(
  pluginId: string,
  commands: RegisteredPluginContributions['commands'],
): RegisteredPluginContributions {
  return {
    pluginId,
    declarationSource: pluginId,
    manifest: {
      id: pluginId,
      name: pluginId,
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0',
      },
    },
    commands,
    slashCommands: [],
  };
}

function createCapturingContext() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    context: {
      cwd: '/tmp/project',
      stdout: (message: string) => output.push(message),
      stderr: (message: string) => errors.push(message),
    },
    output,
    errors,
  };
}

describe('plugin CLI runtime', () => {
  test('supports successful registration and dual command execution forms', async () => {
    const seen: string[][] = [];
    const runtime = createPluginCliRuntime({
      plugins: [
        makePlugin('acme', [
          {
            name: 'deploy',
            summary: 'Ship immediately.',
            execute: (args) => {
              seen.push(args);
              return 0;
            },
          },
        ]),
      ],
      builtInCommands: new Set(['run']),
    });

    const captured = createCapturingContext();
    const topLevel = await runtime.dispatch('deploy', ['--json', '--target', 'prod'], captured.context);
    const namespaced = await runtime.dispatch('acme:deploy', ['--json'], captured.context);

    expect(topLevel).toEqual({ handled: true, exitCode: 0 });
    expect(namespaced).toEqual({ handled: true, exitCode: 0 });
    expect(seen).toEqual([
      ['--json', '--target', 'prod'],
      ['--json'],
    ]);
  });

  test('keeps built-in conflicts unavailable at top-level but available via namespace', async () => {
    const runtime = createPluginCliRuntime({
      plugins: [
        makePlugin('acme', [
          {
            name: 'run',
            summary: 'Plugin run variant',
            execute: () => 0,
          },
        ]),
      ],
      builtInCommands: new Set(['run']),
    });

    const captured = createCapturingContext();
    const topLevel = await runtime.dispatch('run', [], captured.context);
    const namespaced = await runtime.dispatch('acme:run', [], captured.context);

    expect(topLevel.handled).toBeFalse();
    expect(namespaced).toEqual({ handled: true, exitCode: 0 });
    expect(runtime.listCommands()).toEqual([
      expect.objectContaining({
        topLevelName: 'run',
        namespacedName: 'acme:run',
        topLevelAvailable: false,
      }),
    ]);
  });

  test('renders plugin help section with unavailable stubs', () => {
    const runtime = createPluginCliRuntime({
      plugins: [
        makePlugin('acme', [
          {
            name: 'run',
            summary: 'Do not rewrite this tone.',
            execute: () => 0,
          },
        ]),
      ],
      builtInCommands: new Set(['run']),
    });

    const output = renderPluginHelpSection(runtime.listCommands());

    expect(output).toContain('Plugin Commands:');
    expect(output).toContain('run (unavailable: conflicts with built-in command "run")');
    expect(output).toContain('namespaced: acme:run');
    expect(output).toContain('Do not rewrite this tone.');
  });

  test('wraps plugin runtime failures with plugin attribution', async () => {
    const runtime = createPluginCliRuntime({
      plugins: [
        makePlugin('acme', [
          {
            name: 'explode',
            summary: 'Explodes on command.',
            execute: () => {
              throw new Error('boom');
            },
          },
        ]),
      ],
      builtInCommands: new Set(),
    });

    const captured = createCapturingContext();
    const result = await runtime.dispatch('explode', [], captured.context);

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(captured.errors).toEqual(['[plugin:acme] boom']);
  });
});
