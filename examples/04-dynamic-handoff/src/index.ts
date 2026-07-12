import {
  createFred,
  createHandoffTool,
  type Tool,
} from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  const allAgentIds = ['intake', 'billing-specialist', 'tech-specialist'];
  const agents = new Map((await fred.agents.list()).map((agent) => [agent.id, agent]));

  const handoffTool = createHandoffTool(
    (agentId) => agents.get(agentId),
    () => allAgentIds
  );

  await fred.tools.register(handoffTool as unknown as Tool);
  for (const agent of agents.values()) {
    await fred.agents.remove(agent.id);
    await fred.agents.register({
      ...agent.config,
      tools: [handoffTool.id],
    });
  }
  await fred.templates.addContext('departments', () => ({
    available: ['billing-specialist', 'tech-specialist'],
  }));

  console.log('=== Dynamic Handoff Demo (ambient session) ===\n');

  // Both turns use one resumable session, so the intake agent and any handoff
  // target share the same ContextStorage-backed conversation history.
  const session = await fred.sessions.open();
  console.log(`Session: ${session.id}\n`);

  const firstMessage =
    'I was charged twice for my subscription last month and need a refund.';
  console.log(`User: ${firstMessage}`);
  const firstResponse = await fred.messages.process(firstMessage, {
    conversationId: session.id,
  });
  console.log('Assistant:', firstResponse?.content ?? '(no response)');

  console.log('\n--- Follow-up to trigger possible hand-back ---');
  const followUp =
    'The charge was on card ending 4242. If needed, ask intake for any missing details.';
  console.log(`User: ${followUp}`);
  const secondResponse = await fred.messages.process(followUp, {
    conversationId: session.id,
  });
  console.log('Assistant:', secondResponse?.content ?? '(no response)');

  await fred.shutdown();
}

main().catch(console.error);
