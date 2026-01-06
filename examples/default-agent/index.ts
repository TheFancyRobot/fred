import { Fred } from '../../src/index';

/**
 * Example: Default Agent Setup
 * Demonstrates how to set up a default agent that handles all unmatched messages
 */
async function main() {
  const fred = new Fred();

  // Register providers
  fred.registerDefaultProviders();

  // Create a default agent (handles all unmatched messages)
  await fred.createAgent({
    id: 'default-agent',
    systemMessage: 'You are a helpful assistant that can answer general questions and help with various tasks.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });

  // Set it as the default agent
  fred.setDefaultAgent('default-agent');

  // Create a specialized math agent
  await fred.createAgent({
    id: 'math-agent',
    systemMessage: 'You are a math expert. Help users with mathematical problems.',
    platform: 'openai',
    model: 'gpt-4',
  });

  // Register an intent for math questions
  fred.registerIntent({
    id: 'math-question',
    utterances: ['calculate', 'compute', 'what is', 'solve', 'math'],
    action: {
      type: 'agent',
      target: 'math-agent',
    },
  });

  // Test messages
  console.log('Testing intent-based routing:');
  const mathResponse = await fred.processMessage('What is 15 + 27?', {
    conversationId: 'test-conversation',
  });
  console.log('Math question:', mathResponse?.content);

  console.log('\nTesting default agent (unmatched message):');
  const generalResponse = await fred.processMessage('Tell me a joke', {
    conversationId: 'test-conversation',
  });
  console.log('General question:', generalResponse?.content);

  // Context is maintained across messages
  console.log('\nTesting context (follow-up question):');
  const followUp = await fred.processMessage('What was the answer?', {
    conversationId: 'test-conversation',
  });
  console.log('Follow-up:', followUp?.content);
}

// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch(console.error);
}

