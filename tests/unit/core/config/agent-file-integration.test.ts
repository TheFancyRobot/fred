import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentConfig, AgentInstance } from '../../../../packages/core/src/agent/agent';
import { AgentFileParseError } from '../../../../packages/core/src/agent/errors';
import { ConfigInitializer, type FredLike } from '../../../../packages/core/src/config/initializer';
import { validateConfig } from '../../../../packages/core/src/config/loader';
import type { FrameworkConfig } from '../../../../packages/core/src/config/types';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-config-agent-files-'));
  tempDirs.push(directory);
  return directory;
};

const writeJsonConfig = (directory: string, config: FrameworkConfig): string => {
  const configPath = join(directory, 'fred.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
};

const writeAgentDefinition = (filePath: string, id: string): void => {
  writeFileSync(
    filePath,
    `---
id: ${id}
platform: openai
model: gpt-4o-mini
---

You are ${id}.
`
  );
};

const writeInvalidAgentDefinitionMissingId = (filePath: string): void => {
  writeFileSync(
    filePath,
    `---
platform: openai
model: gpt-4o-mini
---

Missing id should fail.
`
  );
};

const createBaseAgent = (id: string, systemMessage = 'Config agent prompt'): AgentConfig => ({
  id,
  platform: 'openai',
  model: 'gpt-4o-mini',
  systemMessage,
});

const createFredMock = (): { fred: FredLike; createdAgents: AgentConfig[] } => {
  const createdAgents: AgentConfig[] = [];

  const fred: FredLike = {
    getAgentManager: () => ({
      setDefaultSystemMessage: () => {},
      hasAgent: (id: string) => createdAgents.some((agent) => agent.id === id),
    }),
    getPipelineManager: () => ({
      setCheckpointManager: () => {},
    }),
    getProviderRegistry: () => ({
      register: async () => {},
      markInitialized: () => {},
    }),
    getProviderService: () => ({
      syncProviderRegistry: () => {},
      registerDefaultProviders: async () => {},
      loadDefaultProviders: async () => {},
    }),
    setDefaultPolicy: () => {},
    setStorage: () => {},
    registerTool: () => {},
    registerIntents: () => {},
    createAgent: async (config: AgentConfig): Promise<AgentInstance> => {
      createdAgents.push(config);
      return {
        id: config.id,
        config,
        processMessage: async () => ({ content: '' }),
      } as AgentInstance;
    },
    createPipeline: async () => ({ id: 'pipeline' } as any),
    configureRouting: () => {},
    configureWorkflows: () => {},
    configureObservability: () => {},
    setToolPolicies: async () => {},
  };

  return { fred, createdAgents };
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('config initializer agent file integration', () => {
  it('accepts FrameworkConfig.agentDirs as a string array', () => {
    const config: FrameworkConfig = {
      agentDirs: ['./agents', './more-agents'],
      agents: [createBaseAgent('config-agent')],
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('loads .md file agents before config-defined agents', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeAgentDefinition(join(agentDir, 'file-agent.md'), 'file-agent');

    const configPath = writeJsonConfig(root, {
      agentDirs: ['./agents'],
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents.map((agent) => agent.id)).toEqual(['file-agent', 'config-agent']);
  });

  it('scans default ./agents when agentDirs is not specified and directory exists', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeAgentDefinition(join(agentDir, 'default-agent.md'), 'default-agent');

    const configPath = writeJsonConfig(root, {
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents.map((agent) => agent.id)).toEqual(['default-agent', 'config-agent']);
  });

  it('does not scan default ./agents when agentDirs is not specified and directory does not exist', async () => {
    const root = makeTempDir();
    const configPath = writeJsonConfig(root, {
      agents: [createBaseAgent('config-only-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents.map((agent) => agent.id)).toEqual(['config-only-agent']);
  });

  it('throws hard error for duplicate IDs across .md and config agents', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeAgentDefinition(join(agentDir, 'duplicate.md'), 'duplicate-id');

    const configPath = writeJsonConfig(root, {
      agentDirs: ['./agents'],
      agents: [createBaseAgent('duplicate-id')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await expect(initializer.initialize(fred, configPath)).rejects.toThrow(
      'Duplicate agent ID "duplicate-id" found across agent sources. Agent IDs must be unique across .md files, config agents, and programmatic registrations.'
    );
    expect(createdAgents).toHaveLength(0);
  });

  it('throws hard error for duplicate IDs between two .md files', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(join(agentDir, 'nested'), { recursive: true });
    writeAgentDefinition(join(agentDir, 'first.md'), 'duplicate-id');
    writeAgentDefinition(join(agentDir, 'nested', 'second.md'), 'duplicate-id');

    const configPath = writeJsonConfig(root, {
      agentDirs: ['./agents'],
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred } = createFredMock();

    await expect(initializer.initialize(fred, configPath)).rejects.toThrow(
      'Duplicate agent ID "duplicate-id" found across agent sources. Agent IDs must be unique across .md files, config agents, and programmatic registrations.'
    );
  });

  it('throws for config systemMessage path pointing to a .md file with frontmatter', async () => {
    const root = makeTempDir();
    const promptsDir = join(root, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(
      join(promptsDir, 'ambiguous.md'),
      `---
id: frontmatter-agent
platform: openai
model: gpt-4o-mini
---

This file is both a prompt and an agent definition.
`
    );

    const configPath = writeJsonConfig(root, {
      agents: [createBaseAgent('config-agent', './prompts/ambiguous.md')],
    });

    const initializer = new ConfigInitializer();
    const { fred } = createFredMock();

    await expect(initializer.initialize(fred, configPath)).rejects.toThrow(
      'Agent "config-agent" references "./prompts/ambiguous.md" as systemMessage, but that file contains YAML frontmatter.'
    );
  });

  it('allows config systemMessage path to plain .md prompt files without frontmatter', async () => {
    const root = makeTempDir();
    const promptsDir = join(root, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, 'plain.md'), 'You are a plain markdown prompt file.');

    const configPath = writeJsonConfig(root, {
      agents: [createBaseAgent('config-agent', './prompts/plain.md')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents).toHaveLength(1);
    expect(createdAgents[0]?.systemMessage).toBe('You are a plain markdown prompt file.');
  });

  it('silently skips .md files without frontmatter in agentDirs', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'prompt-only.md'), 'This file is a plain prompt and should be skipped.');

    const configPath = writeJsonConfig(root, {
      agentDirs: ['./agents'],
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents.map((agent) => agent.id)).toEqual(['config-agent']);
  });

  it('resolves agentDirs relative to the config file directory', async () => {
    const root = makeTempDir();
    const configDir = join(root, 'config');
    mkdirSync(configDir, { recursive: true });

    const defsDir = join(configDir, 'defs');
    mkdirSync(defsDir, { recursive: true });
    writeAgentDefinition(join(defsDir, 'relative-agent.md'), 'relative-agent');

    const configPath = writeJsonConfig(configDir, {
      agentDirs: ['./defs'],
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred, createdAgents } = createFredMock();

    await initializer.initialize(fred, configPath);

    expect(createdAgents.map((agent) => agent.id)).toEqual(['relative-agent', 'config-agent']);
  });

  it('propagates AgentFileParseError when an agent file frontmatter is invalid', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeInvalidAgentDefinitionMissingId(join(agentDir, 'invalid.md'));

    const configPath = writeJsonConfig(root, {
      agentDirs: ['./agents'],
      agents: [createBaseAgent('config-agent')],
    });

    const initializer = new ConfigInitializer();
    const { fred } = createFredMock();

    await expect(initializer.initialize(fred, configPath)).rejects.toBeInstanceOf(AgentFileParseError);
  });
});
