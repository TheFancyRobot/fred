import { Effect, Runtime } from 'effect';
import {
  Fred,
  PipelineBuilder,
  PipelineService,
  SessionService,
  defineWorkflow,
} from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function executePipelineV2(fred: Fred, pipelineId: string, input: string) {
  const runtime = await fred.getRuntime();
  return Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const sessions = yield* SessionService;
      const pipelineService = yield* PipelineService;
      // Open one ambient session for the whole pipeline and run inside it. The
      // pipeline picks up its conversation id from the ambient session — no
      // manual conversationId threading — so the run is bound to a resumable
      // id. (Within a V2 pipeline, step-to-step output flows through the
      // pipeline context; the ambient session is what ties the run to a
      // conversation and lets ContextStorage-backed agents share history.)
      const session = yield* sessions.open();
      return yield* sessions.withSession(
        session,
        pipelineService.executePipelineV2(pipelineId, input)
      );
    })
  );
}

async function main() {
  const fred = await Fred.create();
  await fred.initializeFromConfig('./config.yaml');

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
  await fred.defineWorkflow(nativePreflight);
  const preflight = await fred.executeWorkflow('native-sequential-preflight', ' TypeScript ');
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

  await fred.createPipeline(pipeline);

  console.log('=== Sequential Pipeline Demo ===\n');
  console.log('Executing: classify -> process -> plan -> pause -> summarize\n');

  const firstRun = await executePipelineV2(
    fred,
    'classify-plan-summarize',
    'Help me write a haiku about programming in TypeScript'
  );

  if (firstRun.status === 'paused' && firstRun.runId) {
    console.log('[Pipeline] Paused for human input.');
    console.log('[Pipeline] Simulating restart and resuming from checkpoint...');

    const resumed = await fred.resume(firstRun.runId, {
      humanInput: 'approve',
      resumeBehavior: 'continue',
    });

    console.log('[Pipeline] Resumed status:', resumed.status ?? 'unknown');
    console.log('[Pipeline] Final output:', resumed.finalOutput);
  } else {
    console.log('[Pipeline] Final output:', firstRun.finalOutput);
  }

  await fred.shutdown();
}

main().catch(console.error);
