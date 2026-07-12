import {
  createFred,
  PipelineBuilder,
  defineWorkflow,
} from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  // Native WorkflowIR is useful when the workflow is already graph-shaped and
  // no compatibility builder is needed. This small preflight executes through
  // the same engine as the checkpointed PipelineBuilder workflow below.
  const nativePreflight = defineWorkflow({
    id: 'native-sequential-preflight',
    entry: 'normalize',
    nodes: [
      { id: 'normalize', kind: 'function', fn: (ctx) => String(ctx.input).trim() },
      { id: 'label', kind: 'function', fn: (ctx) => `ready:${ctx.outputs.normalize}` },
    ],
    edges: [{ from: 'normalize', to: 'label' }],
  });
  await fred.workflows.define(nativePreflight);
  const preflight = await fred.workflows.run('native-sequential-preflight', ' TypeScript ');
  if (!('finalOutput' in preflight)) {
    throw new Error('Native preflight did not return a WorkflowIR result');
  }
  console.log('[WorkflowIR] Preflight:', preflight.finalOutput);

  const built = new PipelineBuilder('classify-plan-summarize')
    .addAgentStep('classifier')
    .addFunctionStep('process-classification', async (ctx) => {
      const classification = String(ctx.outputs['classifier'] ?? 'unknown');
      console.log(`[Pipeline] Classification: ${classification}`);
      return { processed: true, classification };
    })
    .addAgentStep('planner')
    .addFunctionStep('pause-for-human-input', async () => {
      return {
        pause: true,
        prompt: 'Approve this generated plan before summarization?',
        choices: ['approve', 'reject'],
        resumeBehavior: 'continue' as const,
      };
    })
    .addAgentStep('summarizer')
    .build();

  const pipeline = {
    ...built,
    checkpoint: { enabled: true },
  };

  await fred.workflows.define(pipeline);

  console.log('=== Sequential Pipeline Demo ===\n');
  console.log('Executing: classify -> process -> plan -> pause -> summarize\n');

  const session = await fred.sessions.open();
  const firstRun = await fred.workflows.run(
    'classify-plan-summarize',
    'Help me write a haiku about programming in TypeScript',
    { sessionId: session.id }
  );

  if ('status' in firstRun && firstRun.status === 'paused' && firstRun.runId) {
    console.log('[Pipeline] Paused for human input.');
    console.log('[Pipeline] Simulating restart and resuming from checkpoint...');

    const resumed = await fred.workflows.resume(firstRun.runId, {
      humanInput: 'approve',
      resumeBehavior: 'continue',
    });

    console.log('[Pipeline] Resumed status:', resumed.status ?? 'unknown');
    console.log('[Pipeline] Final output:', resumed.finalOutput);
  } else {
    console.log(
      '[Pipeline] Final output:',
      'finalOutput' in firstRun
        ? firstRun.finalOutput
        : 'content' in firstRun
          ? firstRun.content
          : JSON.stringify(firstRun),
    );
  }

  await fred.shutdown();
}

main().catch(console.error);
