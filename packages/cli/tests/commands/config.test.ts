import { describe, expect, test } from 'bun:test';
import { handleConfigCommand } from '../../src/commands/config';
import type { ConfigResolutionResult } from '../../src/project/types';
import type { FrameworkConfig } from '../../../../packages/core/src/config/types';

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

function makeValidResult(
  config: Partial<FrameworkConfig> = {},
  configPath = '/project/fred.config.ts',
): ConfigResolutionResult<FrameworkConfig> {
  return {
    success: true,
    config: {
      agents: [
        { id: 'assistant', systemMessage: 'Hello', platform: 'openai', model: 'gpt-4o-mini' },
        { id: 'support', systemMessage: 'Help', platform: 'openai', model: 'gpt-4o' },
        { id: 'coder', systemMessage: 'Code', platform: 'anthropic', model: 'claude-3' },
      ],
      tools: [
        { id: 'calculator', name: 'Calculator', description: 'math' },
        { id: 'search', name: 'Search', description: 'find stuff' },
      ],
      intents: [
        { id: 'greet', utterances: ['hello'], action: { type: 'agent', target: 'assistant' } },
      ],
      ...config,
    } as FrameworkConfig,
    configPath,
    diagnostics: [],
  };
}

function makeFailedResult(
  diagnostics: ConfigResolutionResult<FrameworkConfig>['diagnostics'],
  configPath?: string,
): ConfigResolutionResult<FrameworkConfig> {
  return {
    success: false,
    configPath,
    diagnostics,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('config validate command', () => {
  test('valid config returns exit code 0 with success summary', async () => {
    const { io, output } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], {}, {
      io,
      resolveConfig: () => makeValidResult(),
    });

    expect(exitCode).toBe(0);
    const out = output.join('\n');
    expect(out).toContain('Config valid');
    expect(out).toContain('3 agents');
    expect(out).toContain('2 tools');
    expect(out).toContain('1 intent');
  });

  test('invalid config with errors returns exit code 1 with diagnostics', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], {}, {
      io,
      resolveConfig: () => makeFailedResult([
        {
          code: 'config-parse-error',
          severity: 'error',
          message: 'Unexpected token at position 42',
          path: 'fred.config.ts',
          line: 5,
          column: 12,
          fix: 'Check JSON syntax or TypeScript export format',
        },
      ], 'fred.config.ts'),
    });

    expect(exitCode).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('error[config-parse-error]');
    expect(err).toContain('Unexpected token at position 42');
    expect(err).toContain('--> fred.config.ts:5:12');
    expect(err).toContain('fix: Check JSON syntax');
  });

  test('warnings only returns exit code 2', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], {}, {
      io,
      resolveConfig: () => makeFailedResult([
        {
          code: 'config-deprecated-field',
          severity: 'warning',
          message: 'Field "legacy" is deprecated',
          path: 'fred.config.ts',
          fix: 'Use "modern" instead',
        },
      ], 'fred.config.ts'),
    });

    expect(exitCode).toBe(2);
    const err = errors.join('\n');
    expect(err).toContain('warning[config-deprecated-field]');
    expect(err).toContain('1 warning');
  });

  test('no config found returns exit code 1 with descriptive error', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], {}, {
      io,
      resolveConfig: () => makeFailedResult([
        {
          code: 'config-not-found',
          severity: 'error',
          message: 'No Fred config file found',
          fix: 'Create a fred.config.ts or fred.config.json file in your project root. Run: fred init',
        },
      ]),
    });

    expect(exitCode).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('No Fred config file found');
  });

  test('--json on valid config produces structured JSON', async () => {
    const { io, output } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], { json: true }, {
      io,
      resolveConfig: () => makeValidResult({
        agents: [
          { id: 'a', systemMessage: 'x', platform: 'openai', model: 'm' },
        ] as any[],
        tools: [],
        intents: [],
      }, '/my/fred.config.ts'),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.join(''));
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('validate');
    expect(payload.configPath).toBe('/my/fred.config.ts');
    expect(payload.summary.agents).toBe(1);
    expect(payload.summary.tools).toBe(0);
  });

  test('--json on invalid config produces structured JSON with diagnostics', async () => {
    const { io, output } = createCapturingIO();
    const diag = {
      code: 'config-missing-field',
      severity: 'error' as const,
      message: 'agents must have at least one entry',
      path: 'fred.config.ts',
      fix: 'Add at least one agent to the config',
    };

    const exitCode = await handleConfigCommand(['validate'], { json: true }, {
      io,
      resolveConfig: () => makeFailedResult([diag], 'fred.config.ts'),
    });

    expect(exitCode).toBe(1);
    const payload = JSON.parse(output.join(''));
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe('validate');
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0].code).toBe('config-missing-field');
  });

  test('aggregates multiple plugin diagnostics in human output', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], {}, {
      io,
      resolveConfig: () => makeFailedResult([
        {
          code: 'plugin-fred-version-incompatible',
          severity: 'error',
          message: 'Plugin "@acme/alpha" requires Fred CLI ^9.0.0 but detected Fred CLI 0.2.0. (plugin: @acme/alpha, source: @acme/alpha)',
          path: 'fred.config.ts',
          pluginId: '@acme/alpha',
          declarationSource: '@acme/alpha',
          fix: 'Upgrade Fred CLI or install a compatible plugin version.',
        },
        {
          code: 'plugin-api-deprecated',
          severity: 'error',
          message: 'Plugin "./plugins/legacy.ts" uses deprecated plugin API since 0.1.0. (plugin: ./plugins/legacy.ts, source: ./plugins/legacy.ts)',
          path: 'fred.config.ts',
          pluginId: './plugins/legacy.ts',
          declarationSource: './plugins/legacy.ts',
          fix: 'Update the plugin to a non-deprecated API.',
        },
      ], 'fred.config.ts'),
    });

    expect(exitCode).toBe(1);
    const err = errors.join('\n');
    expect(err).toContain('error[plugin-fred-version-incompatible]');
    expect(err).toContain('error[plugin-api-deprecated]');
    expect(err).toContain('@acme/alpha');
    expect(err).toContain('./plugins/legacy.ts');
    expect(err).toContain('Found 2 errors');
  });

  test('--json includes structured plugin diagnostic metadata', async () => {
    const { io, output } = createCapturingIO();

    const exitCode = await handleConfigCommand(['validate'], { json: true }, {
      io,
      resolveConfig: () => makeFailedResult([
        {
          code: 'plugin-fred-version-incompatible',
          severity: 'error',
          message: 'Plugin "@acme/alpha" requires Fred CLI ^9.0.0 but detected Fred CLI 0.2.0. (plugin: @acme/alpha, source: @acme/alpha)',
          path: 'fred.config.ts',
          pluginId: '@acme/alpha',
          declarationSource: '@acme/alpha',
          fix: 'Upgrade Fred CLI or install a compatible plugin version.',
        },
      ], 'fred.config.ts'),
    });

    expect(exitCode).toBe(1);
    const payload = JSON.parse(output.join(''));
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0].code).toBe('plugin-fred-version-incompatible');
    expect(payload.diagnostics[0].severity).toBe('error');
    expect(payload.diagnostics[0].pluginId).toBe('@acme/alpha');
    expect(payload.diagnostics[0].fix).toContain('compatible');
  });

  test('unknown subcommand returns exit code 1', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand(['unknown-sub'], {}, { io });

    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unknown config subcommand: unknown-sub');
  });

  test('missing subcommand returns exit code 1', async () => {
    const { io, errors } = createCapturingIO();

    const exitCode = await handleConfigCommand([], {}, { io });

    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Missing config subcommand');
  });
});
