import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import type { FrameworkConfig } from '../../../../packages/core/src/config/types';
import {
  TemplateCompileError,
  TemplateResolutionError,
} from '../../../../packages/core/src/template/errors';
import {
  SECURITY_HEADER,
  DEFAULT_ENV_ALLOWLIST,
  checkOutputSize,
  filterEnvVars,
} from '../../../../packages/core/src/template/security';
import {
  buildBodyContext,
  buildFrontmatterContext,
} from '../../../../packages/core/src/template/context';

describe('template errors', () => {
  it('creates TemplateCompileError with required fields', () => {
    const error = new TemplateCompileError({
      filePath: 'agents/support.md',
      message: 'Unexpected token',
      line: 12,
      cause: new Error('parse failure'),
    });

    expect(error._tag).toBe('TemplateCompileError');
    expect(error.filePath).toBe('agents/support.md');
    expect(error.message).toBe('Unexpected token');
    expect(error.line).toBe(12);
    expect(error.cause).toBeDefined();
  });

  it('creates TemplateResolutionError with expression metadata', () => {
    const error = new TemplateResolutionError({
      filePath: 'agents/support.md',
      expression: 'vars.missing',
      message: 'undefined value',
      cause: new Error('runtime failure'),
    });

    expect(error._tag).toBe('TemplateResolutionError');
    expect(error.filePath).toBe('agents/support.md');
    expect(error.expression).toBe('vars.missing');
    expect(error.message).toBe('undefined value');
    expect(error.cause).toBeDefined();
  });
});

describe('template security', () => {
  it('defines SECURITY_HEADER with dangerous globals shadowed', () => {
    const globals = [
      'require',
      'process',
      '__dirname',
      '__filename',
      'globalThis',
      'global',
      'Bun',
      'Deno',
      'eval',
      'Function',
    ];

    for (const name of globals) {
      expect(SECURITY_HEADER.includes(`var ${name} = undefined;`)).toBe(true);
    }
  });

  it('defines default env allowlist values', () => {
    expect(DEFAULT_ENV_ALLOWLIST).toEqual(['NODE_ENV', 'FRED_*', 'LOG_LEVEL', 'DEBUG', 'TZ']);
  });

  it('filters env vars with default allowlist', () => {
    const env = {
      OPENAI_API_KEY: 'secret',
      FRED_FOO: 'allowed',
      NODE_ENV: 'test',
    };

    const filtered = filterEnvVars(env, DEFAULT_ENV_ALLOWLIST);

    expect(filtered.OPENAI_API_KEY).toBeUndefined();
    expect(filtered.FRED_FOO).toBe('allowed');
    expect(filtered.NODE_ENV).toBe('test');
  });

  it('supports custom allowlist wildcard patterns', () => {
    const env = {
      CUSTOM_FOO: 'custom',
      NODE_ENV: 'development',
    };

    const filtered = filterEnvVars(env, ['CUSTOM_*']);

    expect(filtered.CUSTOM_FOO).toBe('custom');
    expect(filtered.NODE_ENV).toBeUndefined();
  });

  it('returns size error when output exceeds max bytes', async () => {
    const output = 'x'.repeat(101);
    const result = await Effect.runPromiseExit(checkOutputSize(output, 100));

    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const cause = result.cause as any;
      expect(String(cause)).toContain('TemplateResolutionError');
    }
  });

  it('returns output unchanged when size is within limit', async () => {
    const output = 'hello';
    const result = await Effect.runPromise(checkOutputSize(output, 100));

    expect(result).toBe(output);
  });
});

describe('template context builders', () => {
  const vars = { name: 'Fred', retries: 3, enabled: true };
  const env = { NODE_ENV: 'test', FRED_REGION: 'us-east-1' };
  const config: FrameworkConfig = {
    defaultSystemMessage: 'Default system message',
    agentDirs: ['./agents'],
  };
  const agent: AgentConfig = {
    id: 'support',
    platform: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1024,
  };

  it('builds frontmatter context without agent namespace', () => {
    const context = buildFrontmatterContext(vars, env, config);

    expect(context.vars).toEqual(vars);
    expect(context.env).toEqual(env);
    expect(context.config.defaultSystemMessage).toBe('Default system message');
    expect((context as Record<string, unknown>).agent).toBeUndefined();
  });

  it('builds body context with agent namespace', () => {
    const context = buildBodyContext(vars, env, agent, config);

    expect(context.agent.id).toBe('support');
    expect(context.agent.model).toBe('gpt-4o-mini');
    expect(context.agent.platform).toBe('openai');
    expect(context.agent.temperature).toBe(0.2);
    expect(context.agent.maxTokens).toBe(1024);
  });

  it('creates fresh context copies to avoid shared mutation', () => {
    const first = buildBodyContext(vars, env, agent, config);
    const second = buildBodyContext(vars, env, agent, config);

    first.vars.name = 'Changed';
    first.env.NODE_ENV = 'production';

    expect(second.vars.name).toBe('Fred');
    expect(second.env.NODE_ENV).toBe('test');
  });

  it('adds custom namespaces to body context top-level', () => {
    const context = buildBodyContext(vars, env, agent, config, {
      extra: { value: 42 },
      tenant: 'acme',
    });

    expect((context as Record<string, any>).extra.value).toBe(42);
    expect((context as Record<string, any>).tenant).toBe('acme');
  });
});
