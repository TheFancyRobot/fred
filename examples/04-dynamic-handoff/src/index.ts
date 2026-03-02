import { Fred, createHandoffTool, type Tool } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  const allAgentIds = ['intake', 'billing-specialist', 'tech-specialist'];

  await fred.createAgent({
    id: 'intake',
    systemMessage: `You are an intake agent.
Route customers to the correct specialist with handoff_to_agent:
- Billing/payment/refund issues -> billing-specialist
- Technical bugs/setup issues -> tech-specialist
If a specialist asks for clarification, take over and ask follow-up questions.`,
    tools: ['handoff_to_agent'],
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'billing-specialist',
    systemMessage: `You handle invoices, billing, payments, and refunds.
If you need more customer details before answering, hand back to intake with handoff_to_agent.`,
    tools: ['handoff_to_agent'],
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'tech-specialist',
    systemMessage: `You handle technical support issues.
If the request is actually billing-related, hand back to intake with handoff_to_agent.`,
    tools: ['handoff_to_agent'],
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  const handoffTool = createHandoffTool(
    (agentId) => fred.getAgent(agentId),
    () => allAgentIds
  );

  fred.registerTool(handoffTool as unknown as Tool);
  fred.setDefaultAgent('intake');

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
