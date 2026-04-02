import { Fred, createHandoffTool, type Tool } from '@fancyrobot/fred';
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

  const conversationId = fred.generateConversationId();

  console.log('=== Dynamic Handoff Demo ===\n');

  const firstMessage = 'I was charged twice for my subscription last month and need a refund.';
  console.log(`User: ${firstMessage}`);
  const firstResponse = await fred.processMessage(firstMessage, { conversationId });
  console.log('Assistant:', firstResponse?.content ?? '(no response)');

  console.log('\n--- Follow-up to trigger possible hand-back ---');
  const followUp = 'The charge was on card ending 4242. If needed, ask intake for any missing details.';
  console.log(`User: ${followUp}`);
  const secondResponse = await fred.processMessage(followUp, { conversationId });
  console.log('Assistant:', secondResponse?.content ?? '(no response)');

  await fred.shutdown();
}

main().catch(console.error);
