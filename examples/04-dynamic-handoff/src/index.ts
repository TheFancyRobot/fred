import {
  Fred,
  createHandoffTool,
  MessageProcessorService,
  SessionService,
  type Tool,
} from '@fancyrobot/fred';
import { Effect, Runtime } from 'effect';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await Fred.create();

  const allAgentIds = ['intake', 'billing-specialist', 'tech-specialist'];

  const handoffTool = createHandoffTool(
    (agentId) => fred.getAgent(agentId),
    () => allAgentIds
  );

  fred.registerTool(handoffTool as unknown as Tool);
  fred.addTemplateContext('departments', () => ({
    available: ['billing-specialist', 'tech-specialist'],
  }));
  await fred.initializeFromConfig('./config.yaml');

  console.log('=== Dynamic Handoff Demo (ambient session) ===\n');

  // The whole conversation reads and writes one ambient session. Neither turn
  // is handed a conversationId — the agents (including the one handed off to)
  // share history through the Effect environment automatically.
  const conversation = Effect.gen(function* () {
    const processor = yield* MessageProcessorService;

    const firstMessage =
      'I was charged twice for my subscription last month and need a refund.';
    console.log(`User: ${firstMessage}`);
    const firstResponse = yield* processor.processMessage(firstMessage);
    console.log('Assistant:', firstResponse?.content ?? '(no response)');

    console.log('\n--- Follow-up to trigger possible hand-back ---');
    const followUp =
      'The charge was on card ending 4242. If needed, ask intake for any missing details.';
    console.log(`User: ${followUp}`);
    const secondResponse = yield* processor.processMessage(followUp);
    console.log('Assistant:', secondResponse?.content ?? '(no response)');
  });

  const runtime = await fred.getRuntime();
  await Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const sessions = yield* SessionService;
      // Session auto-created on first input; its id is resumable at any time.
      const session = yield* sessions.open();
      console.log(`Session: ${session.id}\n`);
      yield* sessions.withSession(session, conversation);
    })
  );

  await fred.shutdown();
}

main().catch(console.error);
