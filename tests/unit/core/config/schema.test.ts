/**
 * Phase 61 / STEP-61-02: FrameworkConfigSchema golden-parity tests.
 *
 * Every config the current loader accepts must decode cleanly through the new
 * schema: all example `config.yaml` fixtures, plus representative rich objects
 * exercising the sections examples don't (agents, tools, intents, pipelines,
 * policies, persistence, memory, mcp, observability).
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Schema } from 'effect';
import { loadConfig } from '../../../../packages/core/src/config/loader';
import { FrameworkConfigSchema } from '../../../../packages/core/src/config/schema';
import { formatConfigIssues } from '../../../../packages/core/src/config/errors';

const decode = Schema.decodeUnknownEither(FrameworkConfigSchema);

const expectAccepted = (config: unknown, label: string) => {
  const result = decode(config, { errors: 'all' });
  if (result._tag === 'Left') {
    const issues = formatConfigIssues(result.left)
      .map((e) => `  - ${e.message}`)
      .join('\n');
    throw new Error(`${label} should decode but failed:\n${issues}`);
  }
  expect(result._tag).toBe('Right');
};

const EXAMPLES_DIR = join(import.meta.dir, '../../../../examples');

describe('FrameworkConfigSchema — example fixtures decode (golden parity)', () => {
  const exampleConfigs = existsSync(EXAMPLES_DIR)
    ? readdirSync(EXAMPLES_DIR)
        .map((dir) => join(EXAMPLES_DIR, dir, 'config.yaml'))
        .filter((p) => existsSync(p))
    : [];

  it('discovers example config fixtures', () => {
    expect(exampleConfigs.length).toBeGreaterThan(0);
  });

  for (const configPath of exampleConfigs) {
    const label = configPath.slice(EXAMPLES_DIR.length + 1);
    it(`decodes ${label}`, () => {
      expectAccepted(loadConfig(configPath), label);
    });
  }
});

describe('FrameworkConfigSchema — rich section fixtures decode', () => {
  it('providers with model defaults, headers, external package', () => {
    expectAccepted(
      {
        providers: [
          { id: 'openai', modelDefaults: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048 } },
          {
            id: 'mistral',
            package: '@fancyrobot/fred-mistral',
            apiKeyEnvVar: 'MISTRAL_API_KEY',
            baseUrl: 'https://api.mistral.ai',
            headers: { 'X-Trace': 'on' },
          },
        ],
      },
      'providers',
    );
  });

  it('agents (open) — no systemMessage but defaultSystemMessage present', () => {
    expectAccepted(
      {
        defaultSystemMessage: 'You are helpful.',
        agents: [
          { id: 'a1', platform: 'openai', model: 'gpt-4' },
          {
            id: 'a2',
            platform: 'anthropic',
            model: 'claude-3',
            systemMessage: 'Custom',
            tools: ['calculator'],
            temperature: 0.2,
          },
        ],
      },
      'agents',
    );
  });

  it('agents accept string, template, and BAML prompt sources', () => {
    expectAccepted(
      {
        agents: [
          { id: 'plain', platform: 'openai', model: 'gpt-4', systemMessage: 'Plain prompt' },
          {
            id: 'template',
            platform: 'openai',
            model: 'gpt-4',
            systemMessage: {
              template: 'Hello <%= vars.name %>',
              variables: { name: 'Ada', attempts: 3, verbose: true },
            },
          },
          {
            id: 'variable-free-template',
            platform: 'openai',
            model: 'gpt-4',
            systemMessage: { template: 'You are helpful.' },
          },
          {
            id: 'baml',
            platform: 'openai',
            model: 'gpt-4',
            systemMessage: { baml: { function: 'BuildAgentPrompt' } },
          },
        ],
      },
      'agent prompt sources',
    );
  });

  it('intents with actions and extra fields', () => {
    expectAccepted(
      {
        intents: [
          {
            id: 'greet',
            utterances: ['hello', 'hi'],
            action: { type: 'agent', target: 'assistant' },
            priority: 10,
          },
        ],
      },
      'intents',
    );
  });

  it('tools (config-defined schema metadata)', () => {
    expectAccepted(
      {
        tools: [
          {
            id: 'lookup',
            name: 'Lookup',
            description: 'Look things up',
            schema: { metadata: { type: 'object', properties: {} } },
          },
        ],
      },
      'tools',
    );
  });

  it('pipelinesV2 with nested conditional steps', () => {
    expectAccepted(
      {
        pipelinesV2: {
          review: {
            description: 'review flow',
            steps: [
              { type: 'agent', name: 'draft', agentId: 'writer' },
              {
                type: 'conditional',
                name: 'gate',
                condition: { field: 'outputs.draft.status', equals: 'ok' },
                whenTrue: [{ type: 'function', name: 'publish', functionId: 'publishFn' }],
                whenFalse: [{ type: 'pipeline', name: 'revise', pipelineId: 'p1' }],
              },
            ],
          },
        },
      },
      'pipelinesV2',
    );
  });

  it('policies with default/intents/agents/overrides', () => {
    expectAccepted(
      {
        policies: {
          default: { deny: ['dangerous'], conflictResolution: 'deny-overrides' },
          intents: { greet: { allow: ['calculator'] } },
          agents: { a1: { requireApproval: ['delete'] } },
          overrides: [
            {
              id: 'o1',
              override: true,
              target: { agentId: 'a1' },
              allow: ['special'],
              conditions: { role: ['admin'], metadata: { tier: 'gold' } },
            },
          ],
        },
      },
      'policies',
    );
  });

  it('persistence, memory, observability, mcpServers, template, plugins', () => {
    expectAccepted(
      {
        persistence: {
          adapter: 'postgres',
          checkpoint: { enabled: true, ttlMs: 604800000, cleanupIntervalMs: 3600000 },
        },
        memory: {
          policy: { maxMessages: 20, maxChars: 8000, strict: true, isolated: false },
          requireConversationId: true,
          sequentialVisibility: false,
        },
        observability: {
          otlp: { endpoint: 'http://localhost:4318/v1/traces', headers: { Authorization: 'Bearer x' } },
          logLevel: 'debug',
          resource: { serviceName: 'fred', serviceVersion: '2.0.0', environment: 'prod', team: 'core' },
          sampling: { successSampleRate: 0.01, slowThresholdMs: 5000, debugMode: false },
          metrics: { pricing: { 'openai:gpt-4': { input: 0.03, output: 0.06 } } },
        },
        mcpServers: {
          github: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: 'x' },
            timeout: 30000,
          },
          remote: {
            transport: 'http',
            url: 'https://api.example.com/mcp',
            headers: { Authorization: 'Bearer y' },
            retry: { maxRetries: 3, backoffMs: 1000 },
            healthCheckIntervalMs: 60000,
            lazy: true,
          },
        },
        template: { partialDirs: ['./partials'], envAllowlist: ['NODE_ENV'], strict: true, maxOutputSize: 65536 },
        plugins: ['@scope/plugin-a', { id: 'b', source: './local-plugin', options: { flag: true } }],
      },
      'infra sections',
    );
  });

  it('toolPolicies alias decodes like policies', () => {
    expectAccepted({ toolPolicies: { default: { allow: ['calculator'] } } }, 'toolPolicies');
  });
});

describe('FrameworkConfigSchema — clearly-invalid inputs are rejected', () => {
  it('rejects the removed top-level pipelines field', () => {
    expect(decode({ pipelines: {} })._tag).toBe('Left');
  });

  it('rejects a wrong-typed known field', () => {
    const result = decode({ agentDirs: 'not-an-array' });
    expect(result._tag).toBe('Left');
  });

  it('rejects an unknown persistence adapter', () => {
    const result = decode({ persistence: { adapter: 'mongodb' } });
    expect(result._tag).toBe('Left');
  });

  it('rejects an unknown mcp transport', () => {
    const result = decode({ mcpServers: { x: { transport: 'carrier-pigeon' } } });
    expect(result._tag).toBe('Left');
  });

  it('rejects a routing block without a rules array (parity with legacy)', () => {
    expect(decode({ routing: { defaultAgent: 'assistant' } })._tag).toBe('Left');
    // an empty rules array is still valid (default-agent-only routing)
    expect(decode({ routing: { defaultAgent: 'assistant', rules: [] } })._tag).toBe('Right');
  });

  it('rejects malformed template and BAML prompt sources', () => {
    const invalidPrompts = [
      { template: 'Invalid variable', variables: { nested: { value: 'nope' } } },
      { template: 42, variables: {} },
      { baml: {} },
      { baml: { function: 42 } },
      { template: 'Ambiguous', variables: {}, baml: { function: 'BuildPrompt' } },
      { unknownPrompt: 'nope' },
    ];

    for (const systemMessage of invalidPrompts) {
      expect(decode({ agents: [{ systemMessage }] })._tag).toBe('Left');
    }
  });
});
