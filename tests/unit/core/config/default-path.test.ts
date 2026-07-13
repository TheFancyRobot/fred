/**
 * Phase 61 / STEP-61-05: canonical schema-first runtime config boundaries.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFred } from '../../../../packages/core/src/client';
import {
  ConfigInitializer,
  type ConfigInitializationTarget,
} from '../../../../packages/core/src/config/initializer';
import { ConfigValidationError } from '../../../../packages/core/src/config/errors';
import { loadConfig } from '../../../../packages/core/src/config/loader';

const tempDirs: string[] = [];

const invalidConfigPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-schema-config-'));
  tempDirs.push(directory);
  const configPath = join(directory, 'fred.yaml');
  writeFileSync(configPath, [
    'agents:',
    '  - id: incomplete',
  ].join('\n'));
  return configPath;
};

const warningConfigPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-schema-config-warnings-'));
  tempDirs.push(directory);
  const configPath = join(directory, 'fred.yaml');
  writeFileSync(configPath, [
    'agents:',
    '  - id: configured-agent',
    '    platform: openai',
    '    model: test-model',
    '    systemMessage: Ready.',
    '    mcpServers:',
    '      - missing-server',
    'workflows:',
    '  demo:',
    '    defaultAgent: missing-agent',
    '    agents:',
    '      - configured-agent',
    'mcpServers:',
    '  local:',
    '    transport: stdio',
  ].join('\n'));
  return configPath;
};

const unusedTarget = (): ConfigInitializationTarget => ({
  setDefaultSystemMessage: async () => {},
  setMemoryDefaults: async () => {},
  setContextPolicy: async () => {},
  setToolPolicies: async () => {},
  registerProvider: async () => {},
  registerDefaultProviders: async () => {},
  configureMCPServers: async () => {},
  registerTool: async () => {},
  configureRouting: async () => {},
  configureWorkflows: async () => {},
  registerIntents: async () => {},
  createAgent: async () => {},
  removeAgent: async () => {},
  hasAgent: async () => false,
  defineWorkflow: async () => {},
  getGlobalVariables: async () => ({}),
  invalidateTemplateCache: async () => {},
  ownAgentFileWatcher: () => {},
  emitWarning: () => {},
});

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const expectActionableConfigFailure = async (operation: Promise<unknown>): Promise<void> => {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ConfigValidationError);
  const error = failure as ConfigValidationError;
  expect(error.errors.length).toBeGreaterThanOrEqual(3);
  expect(error.toString()).toContain('How to fix');
};

describe('schema-first config is the default runtime path', () => {
  it('createFred surfaces aggregated actionable config diagnostics', async () => {
    await expectActionableConfigFailure(createFred({ configPath: invalidConfigPath() }));
  });

  it('ConfigInitializer surfaces the same diagnostics when used directly', async () => {
    const initializer = new ConfigInitializer();
    await expectActionableConfigFailure(
      initializer.initializeServices(unusedTarget(), invalidConfigPath()),
    );
  });

  it('the legacy loadConfig name is a thin schema-first compatibility wrapper', () => {
    expect(() => loadConfig(invalidConfigPath())).toThrow(ConfigValidationError);
  });

  it('preserves valid warn-only workflow and MCP diagnostics', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      loadConfig(warningConfigPath());
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([
      '[Config] Workflow "demo" defaultAgent "missing-agent" not in agents list',
      '[Config] MCP server "local" uses stdio transport but is missing "command" field',
      '[Config] Agent "configured-agent" references unknown MCP server "missing-server"',
    ]);
  });

  it('guards default consumers and the public type against legacy regression', () => {
    const client = readFileSync(
      join(process.cwd(), 'packages/core/src/client.ts'),
      'utf8',
    );
    const initializer = readFileSync(
      join(process.cwd(), 'packages/core/src/config/initializer.ts'),
      'utf8',
    );
    const types = readFileSync(
      join(process.cwd(), 'packages/core/src/config/types.ts'),
      'utf8',
    );
    const loader = readFileSync(
      join(process.cwd(), 'packages/core/src/config/loader.ts'),
      'utf8',
    );

    expect(client).toContain("import { loadValidatedConfig } from './config/load'");
    expect(client).toContain("import { configToLayerOptions } from './config/compile'");
    expect(client).not.toMatch(/import .*\b(?:loadConfig|validateConfig)\b.*config\/loader/);
    expect(initializer).toContain("import { loadValidatedConfig } from './load'");
    expect(initializer).not.toMatch(/\b(?:loadConfig|validateConfig)\b/);
    expect(types).toContain('MutableConfig<FrameworkConfigSchemaType>');
    expect(types).not.toContain('export interface FrameworkConfig');
    expect(loader).toContain('return loadValidatedConfig(filePath)');
    expect(loader).not.toContain('return parseConfigFile(filePath)');
  });
});
