import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentPrompt } from '../../../../packages/core/src/agent/agent';
import type { FrameworkConfig } from '../../../../packages/core/src/config/types';
import {
  extractAgents,
  validateConfig,
  validateNoAmbiguousPromptFiles,
} from '../../../../packages/core/src/config/loader';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-config-agent-prompts-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('config prompt source loading', () => {
  it('loads string prompt files while preserving object prompt sources', () => {
    const directory = makeTemporaryDirectory();
    const configPath = join(directory, 'fred.yaml');
    writeFileSync(join(directory, 'prompt.md'), 'Prompt loaded from Markdown.');

    const templatePrompt = {
      template: 'Hello <%= vars.name %>',
      variables: { name: 'Ada', attempts: 2, verbose: true },
    } as const satisfies AgentPrompt;
    const bamlPrompt = {
      baml: { function: 'BuildAgentPrompt' },
    } as const satisfies AgentPrompt;
    const config = {
      agents: [
        { id: 'markdown', platform: 'openai', model: 'gpt-4', systemMessage: './prompt.md' },
        { id: 'template', platform: 'openai', model: 'gpt-4', systemMessage: templatePrompt },
        { id: 'baml', platform: 'openai', model: 'gpt-4', systemMessage: bamlPrompt },
      ],
    } satisfies FrameworkConfig;

    validateConfig(config);
    const agents = extractAgents(config, configPath);

    expect(agents[0]?.systemMessage).toBe('Prompt loaded from Markdown.');
    expect(agents[1]?.systemMessage).toBe(templatePrompt);
    expect(agents[2]?.systemMessage).toBe(bamlPrompt);
  });

  it('does not interpret object prompt contents as Markdown paths', () => {
    const config = {
      agents: [
        {
          id: 'template',
          platform: 'openai',
          model: 'gpt-4',
          systemMessage: { template: './prompt.md', variables: {} },
        },
        {
          id: 'baml',
          platform: 'openai',
          model: 'gpt-4',
          systemMessage: { baml: { function: 'prompt.md' } },
        },
      ],
    } satisfies FrameworkConfig;

    expect(() => validateNoAmbiguousPromptFiles(config.agents)).not.toThrow();
  });
});
