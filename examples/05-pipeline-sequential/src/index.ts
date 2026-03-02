import { Effect, Runtime } from 'effect';
import { Fred, PipelineBuilder, PipelineService } from '@fancyrobot/fred';

async function executePipelineV2(fred: Fred, pipelineId: string, input: string) {
  const runtime = await fred.getRuntime();
  return Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const pipelineService = yield* PipelineService;
      return yield* pipelineService.executePipelineV2(pipelineId, input);
    })
  );
}

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  await fred.createAgent({
    id: 'classifier',
    systemMessage:
      'Classify user input as one of: question, task, creative. Reply with only the category.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'planner',
    systemMessage: 'Given the classification, produce a short 2-3 step plan.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'summarizer',
    systemMessage: 'Summarize prior pipeline outputs into a concise user-facing response.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

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
