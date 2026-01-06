# Default Agent Example

Example showing how to set up a default agent with intent routing.

## Complete Example

```typescript
import { Fred } from 'fred';

async function main() {
  const fred = new Fred();

  // Register providers
  fred.registerDefaultProviders();

  // Create a default agent (handles all unmatched messages)
  await fred.createAgent({
    id: 'default-agent',
    systemMessage: 'You are a helpful assistant that can answer general questions.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });

  // Set it as the default agent
  fred.setDefaultAgent('default-agent');

  // Create specialized agents
  await fred.createAgent({
    id: 'math-agent',
    systemMessage: 'You are a math expert. Help users with mathematical problems.',
    platform: 'openai',
    model: 'gpt-4',
  });

  await fred.createAgent({
    id: 'code-agent',
    systemMessage: 'You are a coding assistant. Help with programming questions.',
    platform: 'openai',
    model: 'gpt-4',
  });

  // Register intents for specialized agents
  fred.registerIntent({
    id: 'math-question',
    utterances: ['calculate', 'compute', 'what is', 'solve', 'math'],
    action: {
      type: 'agent',
      target: 'math-agent',
    },
  });

  fred.registerIntent({
    id: 'code-question',
    utterances: ['code', 'programming', 'function', 'variable'],
    action: {
      type: 'agent',
      target: 'code-agent',
    },
  });

  // Test messages with conversation context
  const conversationId = 'test-conversation';

  console.log('Testing intent-based routing:');
  const mathResponse = await fred.processMessage('What is 15 + 27?', {
    conversationId,
  });
  console.log('Math question:', mathResponse?.content);

  console.log('\nTesting default agent (unmatched message):');
  const generalResponse = await fred.processMessage('Tell me a joke', {
    conversationId,
  });
  console.log('General question:', generalResponse?.content);

  console.log('\nTesting context (follow-up question):');
  const followUp = await fred.processMessage('What was the answer?', {
    conversationId,
  });
  console.log('Follow-up:', followUp?.content);
}

main().catch(console.error);
```

## Message Flow

1. **Math Question** → Matches `math-question` intent → Routes to `math-agent`
2. **General Question** → No match → Routes to `default-agent`
3. **Follow-up** → Uses context from previous messages → Routes to appropriate agent

## Key Features

- **Intent Routing**: Specific messages route to specialized agents
- **Default Fallback**: Unmatched messages go to default agent
- **Context Preservation**: Conversation history maintained across agents
- **Seamless Experience**: Users see one continuous conversation

## Next Steps

- Try the [Chat Tool Integration Example](chat-tool-integration.md)
- Learn about [Context Management](../guides/context-management.md)
- Check [API Reference](../api-reference/fred-class.md)

