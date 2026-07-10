import { describe, expect, it } from 'bun:test';

describe('Phase 63 workflow unification guard', () => {
  it('keeps legacy executor modules as compile-and-adapt shims only', async () => {
    const pipeline = await Bun.file('packages/core/src/pipeline/executor.ts').text();
    const graph = await Bun.file('packages/core/src/pipeline/graph-executor.ts').text();

    expect(pipeline).toContain('compilePipelineV2');
    expect(pipeline).toContain('executeWorkflowEffect');
    expect(pipeline).not.toContain('executeStepWithRetry');
    expect(pipeline).not.toContain('executeStepWithHooks');

    expect(graph).toContain('compileGraphWorkflow');
    expect(graph).toContain('executeWorkflowEffect');
    expect(graph).not.toContain('topologicalSort');
    expect(graph).not.toContain('function executeNode(');
    expect(graph).not.toContain('function handleHandoff(');
  });

  it('routes the Promise client through the unified registry and executor', async () => {
    const client = await Bun.file('packages/core/src/client.ts').text();
    expect(client).toContain('service.defineWorkflow(config)');
    expect(client).toContain('service.getWorkflowIR(id)');
    expect(client).toContain('executeWorkflowViaRuntime(runtime, workflow, input');
    expect(client).not.toContain('hasGraphWorkflow(id)');
    expect(client).not.toContain('hasPipelineV2(id)');
  });

  it('keeps V1, V2, graph, and native definitions in one compiled registry', async () => {
    const service = await Bun.file('packages/core/src/pipeline/service.ts').text();
    expect(service).toContain('private workflows: Ref.Ref<Map<string, WorkflowIR>>');
    expect(service).toContain('compilePipelineV1(config)');
    expect(service).toContain('compilePipelineV2(config)');
    expect(service).toContain('compileGraphWorkflow(config)');
    expect(service).toContain('compileWorkflow(config)');
  });
});
