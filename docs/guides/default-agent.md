# Default Agent

The default agent handles all messages that don't match any intent. This ensures every message gets a response.

## Why Default Agent?

Without a default agent, unmatched messages return `null`. With a default agent:

- **Always Responsive**: Every message gets a response
- **Better UX**: Users never see "no response" errors
- **Fallback**: Handles general queries and edge cases

## Setting Up Default Agent

### Basic Setup

```typescript
// Create an agent
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant that can answer general questions.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

// Set as default
fred.setDefaultAgent('default-agent');
```

### With Intent Routing

```typescript
// Create specialized agents
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math expert.',
  platform: 'openai',
  model: 'gpt-4',
});

await fred.createAgent({
  id: 'code-agent',
  systemMessage: 'You are a coding assistant.',
  platform: 'openai',
  model: 'gpt-4',
});

// Create default agent
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful general assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('default-agent');

// Register intents for specialized agents
fred.registerIntent({
  id: 'math',
  utterances: ['calculate', 'math'],
  action: { type: 'agent', target: 'math-agent' },
});

fred.registerIntent({
  id: 'code',
  utterances: ['code', 'programming'],
  action: { type: 'agent', target: 'code-agent' },
});

// Now:
// - Math questions → math-agent
// - Code questions → code-agent
// - Everything else → default-agent
```

## Default Agent Behavior

### Message Flow

1. User sends message
2. Fred tries to match intent
3. If match found → route to intent's agent
4. If no match → route to default agent
5. Default agent always responds

### Example

```typescript
// Math question → routes to math-agent
await fred.processMessage('Calculate 5 + 3');

// Code question → routes to code-agent
await fred.processMessage('How do I write a function?');

// General question → routes to default-agent
await fred.processMessage('What is the weather?');
```

## Best Practices

### General Purpose Default Agent

```typescript
await fred.createAgent({
  id: 'default-agent',
  systemMessage: `You are a helpful assistant. You can answer general questions,
    help with various tasks, and provide information. If you don't know something,
    be honest about it.`,
  platform: 'openai',
  model: 'gpt-3.5-turbo',  // Cost-effective for general queries
});
```

### Cost-Effective Default Agent

Use a cheaper/faster model for the default agent since it handles many messages:

```typescript
// Specialized agents use expensive models
await fred.createAgent({
  id: 'math-agent',
  platform: 'openai',
  model: 'gpt-4',  // Expensive but capable
});

// Default agent uses cheaper model
await fred.createAgent({
  id: 'default-agent',
  platform: 'groq',  // Fast and cheap
  model: 'llama-3-70b-8192',
});
```

### Context-Aware Default Agent

```typescript
await fred.createAgent({
  id: 'default-agent',
  systemMessage: `You are a helpful assistant. Maintain context from previous
    messages in the conversation. Be friendly and helpful.`,
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

// Context is automatically maintained
const response1 = await fred.processMessage('My name is Alice', { conversationId: 'conv1' });
const response2 = await fred.processMessage('What is my name?', { conversationId: 'conv1' });
// Agent remembers: "Your name is Alice"
```

## Checking Default Agent

```typescript
// Get default agent ID
const defaultAgentId = fred.getDefaultAgentId();
console.log(defaultAgentId); // 'default-agent'

// Get default agent instance
const defaultAgent = fred.getAgent(defaultAgentId);
```

## Updating Default Agent

```typescript
// Create new default agent
await fred.createAgent({
  id: 'new-default',
  systemMessage: 'You are an updated assistant.',
  platform: 'openai',
  model: 'gpt-4',
});

// Update default agent
fred.setDefaultAgent('new-default');
```

## Examples

### Multi-Agent System with Default

```typescript
// Customer support system
await fred.createAgent({
  id: 'support-refund',
  systemMessage: 'You handle refund requests.',
  platform: 'openai',
  model: 'gpt-4',
});

await fred.createAgent({
  id: 'support-technical',
  systemMessage: 'You handle technical issues.',
  platform: 'openai',
  model: 'gpt-4',
});

await fred.createAgent({
  id: 'default-support',
  systemMessage: 'You are a general customer support agent.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('default-support');

fred.registerIntent({
  id: 'refund',
  utterances: ['refund', 'return money'],
  action: { type: 'agent', target: 'support-refund' },
});

fred.registerIntent({
  id: 'technical',
  utterances: ['bug', 'not working', 'error'],
  action: { type: 'agent', target: 'support-technical' },
});
```

## Next Steps

- Learn about [Context Management](context-management.md)
- Explore [Agents](agents.md)
- Check [API Reference](../api-reference/fred-class.md)

