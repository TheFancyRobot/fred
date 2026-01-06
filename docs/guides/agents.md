# Agents

Agents are the core of Fred. They represent AI assistants with specific behaviors, capabilities, and tools.

## Creating Agents

### Basic Agent

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});
```

### Agent with Tools

```typescript
// Register tools first
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform arithmetic',
  parameters: { /* ... */ },
  execute: async (args) => { /* ... */ },
});

// Create agent with tools
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'], // Reference tool IDs
});
```

### Agent Configuration Options

```typescript
await fred.createAgent({
  id: 'custom-agent',
  systemMessage: 'You are a creative writer.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['tool1', 'tool2'],
  temperature: 0.8,      // Creativity level (0-1)
  maxTokens: 2000,       // Maximum response length
});
```

## System Messages

System messages define the agent's personality and behavior:

```typescript
// Friendly assistant
systemMessage: 'You are a friendly and helpful assistant.'

// Expert in a domain
systemMessage: 'You are an expert software engineer specializing in TypeScript and AI.'

// Specific role
systemMessage: 'You are a customer support agent. Be professional and empathetic.'
```

## Platform and Model Selection

### OpenAI

```typescript
await fred.useProvider('openai', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'openai',
  model: 'gpt-4',           // or 'gpt-3.5-turbo', 'gpt-4-turbo', etc.
});
```

### Groq

```typescript
await fred.useProvider('groq', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'groq',
  model: 'llama-3-70b-8192',  // or other Groq models
});
```

### Anthropic

```typescript
await fred.useProvider('anthropic', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'anthropic',
  model: 'claude-3-opus-20240229',  // or other Claude models
});
```

## Using Agents

### Direct Agent Access

```typescript
const agent = fred.getAgent('my-agent');
if (agent) {
  const response = await agent.processMessage('Hello!');
}
```

### Through Intent Routing

```typescript
fred.registerIntent({
  id: 'math',
  utterances: ['calculate', 'math'],
  action: {
    type: 'agent',
    target: 'math-agent',  // Routes to this agent
  },
});

const response = await fred.processMessage('Calculate 5 + 3');
// Automatically routes to math-agent
```

### As Default Agent

```typescript
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('default-agent');

// All unmatched messages go to default-agent
const response = await fred.processMessage('Hello!');
```

## Agent Response

Agents return responses with content and optional tool calls:

```typescript
const response = await agent.processMessage('Calculate 10 * 5');

console.log(response.content);  // "The result is 50"
console.log(response.toolCalls); // Array of tool calls if any
```

## Best Practices

1. **Clear System Messages**: Be specific about the agent's role and behavior
2. **Appropriate Models**: Use faster/cheaper models for simple tasks, powerful models for complex ones
3. **Tool Assignment**: Only assign relevant tools to agents
4. **Default Agent**: Always set a default agent to handle unmatched messages
5. **Temperature**: Adjust based on need (lower for factual, higher for creative)

## Next Steps

- Learn about [Intents](intents.md)
- Explore [Tools](tools.md)
- Check [Default Agent](default-agent.md)

