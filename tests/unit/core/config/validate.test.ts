/**
 * Phase 61 / STEP-61-03: semantic config validation.
 *
 * Asserts each cross-field rule fires with a helpful remediation, that errors
 * accumulate (not fail-fast), and that valid configs produce none.
 */
import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { FrameworkConfigSchema, type FrameworkConfigSchemaType } from '../../../../packages/core/src/config/schema';
import { validateFrameworkConfig } from '../../../../packages/core/src/config/validate';

/** Decode then semantically validate, returning the ConfigError list. */
const validate = (raw: unknown) => {
  const decoded = Schema.decodeUnknownSync(FrameworkConfigSchema)(raw) as FrameworkConfigSchemaType;
  return validateFrameworkConfig(decoded);
};

const findByPath = (raw: unknown, path: string) => validate(raw).find((e) => e.path === path);

describe('validateFrameworkConfig — valid configs', () => {
  it('returns no errors for an agent relying on defaultSystemMessage', () => {
    expect(
      validate({
        defaultSystemMessage: 'You are helpful.',
        agents: [{ id: 'a1', platform: 'openai', model: 'gpt-4' }],
      }),
    ).toHaveLength(0);
  });

  it('returns no errors for a complete policies block referencing declared ids', () => {
    expect(
      validate({
        defaultSystemMessage: 'x',
        agents: [{ id: 'a1', platform: 'openai', model: 'gpt-4' }],
        intents: [{ id: 'greet', utterances: ['hi'], action: { type: 'agent', target: 'a1' } }],
        tools: [
          { id: 'calc', name: 'Calc', description: 'calc' },
          { id: 'rm', name: 'Rm', description: 'rm' },
        ],
        policies: {
          intents: { greet: { allow: ['calc'] } },
          agents: { a1: { deny: ['rm'] } },
          overrides: [{ id: 'o1', override: true, target: { agentId: 'a1' } }],
        },
      }),
    ).toHaveLength(0);
  });
});

describe('validateFrameworkConfig — required fields', () => {
  it('flags an agent missing platform/model with remediation', () => {
    const platformErr = findByPath({ defaultSystemMessage: 'x', agents: [{ id: 'a1' }] }, 'agents[0].platform');
    expect(platformErr?.issue).toContain('must have a platform');
    expect(platformErr?.remediation).toContain('platform');
  });

  it('flags an agent with neither systemMessage nor defaultSystemMessage', () => {
    const err = findByPath({ agents: [{ id: 'a1', platform: 'openai', model: 'gpt-4' }] }, 'agents[0].systemMessage');
    expect(err?.issue).toContain('systemMessage or defaultSystemMessage');
    expect(err?.remediation).toContain('defaultSystemMessage');
  });

  it('flags an intent missing utterances and action', () => {
    const errors = validate({ intents: [{ id: 'greet' }] });
    expect(errors.some((e) => e.path === 'intents[0].utterances')).toBe(true);
    expect(errors.some((e) => e.path === 'intents[0].action')).toBe(true);
  });

  it('flags a tool missing name/description', () => {
    const errors = validate({ tools: [{ id: 't1' }] });
    expect(errors.some((e) => e.path === 'tools[0].name')).toBe(true);
    expect(errors.some((e) => e.path === 'tools[0].description')).toBe(true);
  });

  it('flags strict tool metadata that is not type object / lacks properties', () => {
    const errors = validate({
      tools: [{ id: 't1', name: 'T', description: 'd', strict: true, schema: { metadata: { type: 'string' } } }],
    });
    expect(errors.some((e) => e.path === 'tools[0].schema.metadata.type')).toBe(true);
    expect(errors.some((e) => e.path === 'tools[0].schema.metadata.properties')).toBe(true);
  });

  it('flags metadata.properties that is present but not an object', () => {
    const errors = validate({
      tools: [{ id: 't1', name: 'T', description: 'd', schema: { metadata: { type: 'object', properties: 'nope' } } }],
    });
    expect(errors.some((e) => e.path === 'tools[0].schema.metadata.properties')).toBe(true);
  });
});

describe('validateFrameworkConfig — tool-policy rule contents', () => {
  it('flags an unknown tool reference in a policy rule', () => {
    const errors = validate({ policies: { default: { allow: ['ghost-tool'] } } });
    const err = errors.find((e) => e.path === 'policies.default.allow');
    expect(err?.issue).toContain('unknown tool "ghost-tool"');
  });

  it('flags a duplicate tool reference', () => {
    const errors = validate({
      tools: [{ id: 't1', name: 'T', description: 'd' }],
      policies: { default: { allow: ['t1', 't1'] } },
    });
    expect(errors.some((e) => e.issue.includes('duplicate tool reference "t1"'))).toBe(true);
  });

  it('flags allow/deny and deny/requireApproval conflicts', () => {
    const errors = validate({
      tools: [
        { id: 't1', name: 'T1', description: 'd' },
        { id: 't2', name: 'T2', description: 'd' },
      ],
      policies: { default: { allow: ['t1'], deny: ['t1', 't2'], requireApproval: ['t2'] } },
    });
    expect(errors.some((e) => e.issue.includes('conflicting allow/deny'))).toBe(true);
    expect(errors.some((e) => e.issue.includes('conflicting deny/requireApproval'))).toBe(true);
  });

  it('validates rule contents inside overrides too', () => {
    const errors = validate({
      defaultSystemMessage: 'x',
      agents: [{ id: 'a1', platform: 'openai', model: 'm' }],
      policies: { overrides: [{ id: 'o1', override: true, target: { agentId: 'a1' }, allow: ['ghost'] }] },
    });
    expect(errors.some((e) => e.path === 'policies.overrides[0].allow' && e.issue.includes('unknown tool'))).toBe(true);
  });
});

describe('validateFrameworkConfig — uniqueness & references', () => {
  it('flags duplicate pipeline ids', () => {
    const errors = validate({
      defaultSystemMessage: 'x',
      pipelines: [
        { id: 'p1', agents: ['a1'] },
        { id: 'p1', agents: ['a2'] },
      ],
    });
    expect(errors.some((e) => e.path === 'pipelines[1].id' && e.issue.includes('duplicate'))).toBe(true);
  });

  it('flags a pipeline with no agents', () => {
    const err = findByPath({ defaultSystemMessage: 'x', pipelines: [{ id: 'p1', agents: [] }] }, 'pipelines[0].agents');
    expect(err?.issue).toContain('at least one agent');
  });

  it('rejects both policies and toolPolicies together', () => {
    const err = findByPath(
      { policies: { default: { allow: ['a'] } }, toolPolicies: { default: { allow: ['b'] } } },
      'toolPolicies',
    );
    expect(err?.issue).toContain('both');
    expect(err?.remediation).toContain('only one');
  });

  it('flags a policy referencing an unknown agent', () => {
    const err = findByPath(
      { defaultSystemMessage: 'x', agents: [{ id: 'a1', platform: 'openai', model: 'm' }], policies: { agents: { ghost: { deny: ['x'] } } } },
      'policies.agents.ghost',
    );
    expect(err?.issue).toContain('unknown agent');
  });

  it('flags an override without a target scope and duplicate override ids', () => {
    const errors = validate({
      policies: {
        overrides: [
          { id: 'o1', override: true, target: {} },
          { id: 'o1', override: true, target: { agentId: 'a1' } },
        ],
      },
      defaultSystemMessage: 'x',
      agents: [{ id: 'a1', platform: 'openai', model: 'm' }],
    });
    expect(errors.some((e) => e.path === 'policies.overrides[0].target')).toBe(true);
    expect(errors.some((e) => e.path === 'policies.overrides[1].id' && e.issue.includes('duplicate'))).toBe(true);
  });
});

describe('validateFrameworkConfig — pipelinesV2 step references', () => {
  it('returns no errors when a pipeline step names a declared pipelinesV2 key', () => {
    expect(
      validate({
        pipelinesV2: {
          main: { steps: [{ type: 'pipeline', name: 'call-sub', pipelineId: 'sub' }] },
          sub: { steps: [{ type: 'agent', name: 'run', agentId: 'a1' }] },
        },
      }),
    ).toHaveLength(0);
  });

  it('resolves a pipeline step against a declared V1 pipelines[].id', () => {
    expect(
      validate({
        pipelines: [{ id: 'legacy', agents: ['a1'] }],
        pipelinesV2: {
          main: { steps: [{ type: 'pipeline', name: 'call-legacy', pipelineId: 'legacy' }] },
        },
      }),
    ).toHaveLength(0);
  });

  it('flags a pipeline step referencing an unknown pipeline with remediation', () => {
    const err = findByPath(
      { pipelinesV2: { main: { steps: [{ type: 'pipeline', name: 'call-ghost', pipelineId: 'ghost' }] } } },
      'pipelinesV2.main.steps[0].pipelineId',
    );
    expect(err?.issue).toContain('unknown pipeline "ghost"');
    expect(err?.remediation).toContain('pipelinesV2');
  });

  it('does NOT flag an agent step whose agentId is absent from config.agents (dynamic registration)', () => {
    expect(
      validate({
        pipelinesV2: { main: { steps: [{ type: 'agent', name: 'run', agentId: 'registered-in-code' }] } },
      }),
    ).toHaveLength(0);
  });

  it('does NOT flag a function step (functions are registered in code, not the config)', () => {
    expect(
      validate({
        pipelinesV2: { main: { steps: [{ type: 'function', name: 'transform', functionId: 'my-fn' }] } },
      }),
    ).toHaveLength(0);
  });

  it('recurses into a conditional step whenTrue/whenFalse branches with precise paths', () => {
    const errors = validate({
      pipelinesV2: {
        main: {
          steps: [
            {
              type: 'conditional',
              name: 'branch',
              condition: { field: 'x', exists: true },
              whenTrue: [{ type: 'pipeline', name: 'call-ghost-t', pipelineId: 'ghost-true' }],
              whenFalse: [{ type: 'pipeline', name: 'call-ghost-f', pipelineId: 'ghost-false' }],
            },
          ],
        },
      },
    });
    expect(errors.some((e) => e.path === 'pipelinesV2.main.steps[0].whenTrue[0].pipelineId')).toBe(true);
    expect(errors.some((e) => e.path === 'pipelinesV2.main.steps[0].whenFalse[0].pipelineId')).toBe(true);
  });

  it('recurses into deeply nested conditionals', () => {
    const err = findByPath(
      {
        pipelinesV2: {
          main: {
            steps: [
              {
                type: 'conditional',
                name: 'outer',
                condition: { field: 'x', exists: true },
                whenTrue: [
                  {
                    type: 'conditional',
                    name: 'inner',
                    condition: { field: 'y', exists: true },
                    whenTrue: [{ type: 'pipeline', name: 'deep', pipelineId: 'ghost' }],
                  },
                ],
              },
            ],
          },
        },
      },
      'pipelinesV2.main.steps[0].whenTrue[0].whenTrue[0].pipelineId',
    );
    expect(err?.issue).toContain('unknown pipeline "ghost"');
  });

  it('accumulates one error per unresolved reference across pipelines', () => {
    const errors = validate({
      pipelinesV2: {
        p1: { steps: [{ type: 'pipeline', name: 's', pipelineId: 'nope-1' }] },
        p2: { steps: [{ type: 'pipeline', name: 's', pipelineId: 'nope-2' }] },
      },
    });
    expect(errors.filter((e) => e.issue.includes('unknown pipeline'))).toHaveLength(2);
  });

  it('allows a pipeline step that self-references its own pipelinesV2 key', () => {
    expect(
      validate({
        pipelinesV2: { loop: { steps: [{ type: 'pipeline', name: 'again', pipelineId: 'loop' }] } },
      }),
    ).toHaveLength(0);
  });
});

describe('validateFrameworkConfig — accumulation', () => {
  it('reports every problem at once rather than only the first', () => {
    const errors = validate({ agents: [{ id: 'a1' }, { id: 'a2' }] });
    // Each agent: missing systemMessage/default, platform, model = 3 each = 6 total.
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});
