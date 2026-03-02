import { afterEach, describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  validateAllTemplates,
  securityLintTemplate,
  compileTemplate,
  resolveAgentTemplate,
} from '../../../../packages/core/src/template/validate';
import { TemplateCompileError } from '../../../../packages/core/src/template/errors';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-template-validate-'));
  tempDirs.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('template validate utilities', () => {
  it('validateAllTemplates marks valid templates as valid', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, 'assistant.md'),
      `---
id: assistant
platform: openai
model: gpt-4o-mini
---

Hello <%= vars.name %>
`
    );

    const results = await validateAllTemplates(['./agents'], root);

    expect(results).toHaveLength(1);
    expect(results[0]?.valid).toBe(true);
  });

  it('validateAllTemplates reports invalid eta syntax errors', async () => {
    const root = makeTempDir();
    const agentDir = join(root, 'agents');
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, 'broken.md'),
      `---
id: broken
platform: openai
model: gpt-4o-mini
---

<% if (vars.enabled) { %>
missing end tag
`
    );

    const results = await validateAllTemplates(['./agents'], root);

    expect(results).toHaveLength(1);
    expect(results[0]?.valid).toBe(false);
    expect(results[0]?.error).toBeString();
  });

  it('securityLintTemplate warns on restricted globals', () => {
    const warnings = securityLintTemplate(`<%= require('fs') %>`, 'agents/unsafe.md');

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('require');
  });

  it('securityLintTemplate does not warn on safe vars access', () => {
    const warnings = securityLintTemplate(`<%= vars.name %>`, 'agents/safe.md');

    expect(warnings).toHaveLength(0);
  });

  it('compileTemplate succeeds for valid syntax', async () => {
    await expect(Effect.runPromise(compileTemplate('Hello <%= vars.name %>'))).resolves.toBeUndefined();
  });

  it('compileTemplate fails with TemplateCompileError for invalid syntax', async () => {
    const exit = await Effect.runPromiseExit(compileTemplate('<% if (vars.name) { %>'));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const message = String(exit.cause);
      expect(message).toContain('TemplateCompileError');
    }
  });

  it('resolveAgentTemplate resolves template with body context', async () => {
    const output = await Effect.runPromise(resolveAgentTemplate('Hello <%= vars.name %> from <%= agent.id %>', {
      vars: { name: 'Fred' },
      env: {},
      config: {},
      agent: {
        id: 'assistant',
        model: 'gpt-4o-mini',
        platform: 'openai',
      },
    }));

    expect(output).toBe('Hello Fred from assistant');
  });
});
