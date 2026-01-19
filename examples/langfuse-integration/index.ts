/**
 * Langfuse Integration Example
 * 
 * This example demonstrates how to use Langfuse with Fred for:
 * - Automatic tracing of AI SDK calls
 * - Loading prompts from Langfuse
 * - Viewing traces in Langfuse dashboard
 * 
 * Prerequisites:
 * 1. Install Langfuse packages:
 *    bun add @langfuse/client @langfuse/otel @opentelemetry/sdk-node
 * 
 * 2. Set environment variables:
 *    LANGFUSE_SECRET_KEY=sk-lf-...
 *    LANGFUSE_PUBLIC_KEY=pk-lf-...
 *    LANGFUSE_BASE_URL=https://cloud.langfuse.com
 *    OPENAI_API_KEY=your-openai-key
 */

import { Fred } from '../../src/index';

async function main() {
  console.log('=== Langfuse Integration Example ===\n');

  // Create Fred instance
  const fred = new Fred();

  // Step 1: Enable Langfuse integration
  // This initializes OpenTelemetry with LangfuseSpanProcessor
  // All AI SDK calls will automatically send traces to Langfuse
  console.log('1. Enabling Langfuse integration...');
  fred.useLangfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
  });
  console.log('   ✓ Langfuse enabled\n');

  // Step 2: Register provider
  console.log('2. Registering OpenAI provider...');
  await fred.useProvider('openai', {
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('   ✓ Provider registered\n');

  // Step 3: Create agent with Langfuse prompt
  // Option A: Use Langfuse prompt URI
  console.log('3. Creating agent with Langfuse prompt...');
  try {
    await fred.createAgent({
      id: 'langfuse-agent',
      systemMessage: 'langfuse://assistant-prompt', // Fetches from Langfuse
      platform: 'openai',
      model: 'gpt-4o-mini',
    });
    console.log('   ✓ Agent created with Langfuse prompt\n');
  } catch (error) {
    // If prompt doesn't exist, create agent with regular prompt
    console.log('   ⚠ Langfuse prompt not found, using regular prompt...');
    await fred.createAgent({
      id: 'langfuse-agent',
      systemMessage: 'You are a helpful assistant. This prompt will be traced in Langfuse.',
      platform: 'openai',
      model: 'gpt-4o-mini',
    });
    console.log('   ✓ Agent created with regular prompt\n');
  }

  // Step 4: Set as default agent
  fred.setDefaultAgent('langfuse-agent');
  console.log('4. Set as default agent\n');

  // Step 5: Process messages - traces automatically sent to Langfuse
  console.log('5. Processing messages (traces sent to Langfuse automatically)...\n');

  const messages = [
    'What is the capital of France?',
    'Tell me a joke',
    'What is 2 + 2?',
  ];

  for (const message of messages) {
    console.log(`   User: ${message}`);
    const response = await fred.processMessage(message);
    console.log(`   Agent: ${response.content.substring(0, 100)}...`);
    console.log(`   ✓ Trace sent to Langfuse\n`);
  }

  console.log('=== Example Complete ===');
  console.log('\nView your traces at:');
  console.log(`  ${process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'}`);
  console.log('\nEach message processed above has been automatically traced in Langfuse.');
  console.log('You can view token usage, latency, and full conversation flows.');
}

// Run the example
if (import.meta.main) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
