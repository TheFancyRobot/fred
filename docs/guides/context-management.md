# Context Management

Fred maintains conversation context across all agents, making multi-agent conversations seamless. Users see one continuous conversation even when messages are routed to different agents.

## How Context Works

### Global Context

Context is shared across all agents in a conversation:

```typescript
const conversationId = 'my-conversation';

// First message
const response1 = await fred.processMessage('My name is Alice', { 
  conversationId 
});

// Second message - context is maintained
const response2 = await fred.processMessage('What is my name?', { 
  conversationId 
});
// Agent remembers: "Your name is Alice"
```

### Multi-Agent Context

Context persists even when routing to different agents:

```typescript
const conversationId = 'conv-123';

// Message routed to math-agent
await fred.processMessage('Calculate 5 + 3', { conversationId });

// Message routed to default-agent
await fred.processMessage('What was the previous calculation?', { conversationId });
// Default agent can see the previous math conversation
```

## Conversation IDs

### Auto-Generated IDs

If you don't provide a conversation ID, Fred generates one:

```typescript
const response = await fred.processMessage('Hello!');
// Conversation ID is auto-generated and maintained
```

### Custom Conversation IDs

Use custom IDs for better control:

```typescript
const conversationId = `user-${userId}-session-${sessionId}`;

await fred.processMessage('Hello!', { conversationId });
await fred.processMessage('How are you?', { conversationId });
```

### Getting Conversation ID

```typescript
const contextManager = fred.getContextManager();
const conversationId = contextManager.generateConversationId();
```

## Context Manager API

### Get Conversation History

```typescript
const contextManager = fred.getContextManager();
const history = await contextManager.getHistory(conversationId);

console.log(history); // Array of CoreMessage objects
```

### Clear Context

```typescript
const contextManager = fred.getContextManager();
await contextManager.clearContext(conversationId);
```

### Update Metadata

```typescript
const contextManager = fred.getContextManager();
await contextManager.updateMetadata(conversationId, {
  userId: 'user123',
  sessionStart: new Date(),
});
```

## Message Format

Fred uses AI SDK's `CoreMessage` format internally:

```typescript
interface CoreMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{ type: string; text: string }>;
}
```

## Context in Chat API

The chat API automatically manages context:

```typescript
// POST /v1/chat/completions
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "conversation_id": "my-conversation"  // Optional
}
```

Context is maintained across all requests with the same `conversation_id`.

## Best Practices

### Session Management

```typescript
// Generate conversation ID per user session
function getConversationId(userId: string): string {
  return `user-${userId}-${Date.now()}`;
}

const conversationId = getConversationId('user123');
```

### Context Cleanup

```typescript
// Clear old conversations
async function cleanupOldConversations(maxAge: number) {
  const contextManager = fred.getContextManager();
  // Implementation depends on storage backend
}
```

### Context Limits

For very long conversations, consider:

1. **Summarization**: Periodically summarize old messages
2. **Truncation**: Keep only recent N messages
3. **Pagination**: Load context in chunks

## Storage

By default, context is stored in-memory. For production:

1. **Implement Custom Storage**: Create a `ContextStorage` implementation
2. **Use Database**: Store conversations in a database
3. **Persistence**: Save context to disk or cloud storage

### Custom Storage Example

```typescript
import { ContextStorage, ConversationContext } from 'fred';

class DatabaseStorage implements ContextStorage {
  async get(id: string): Promise<ConversationContext | null> {
    // Load from database
  }
  
  async set(id: string, context: ConversationContext): Promise<void> {
    // Save to database
  }
  
  // ... other methods
}

const storage = new DatabaseStorage();
const contextManager = new ContextManager(storage);
fred.getContextManager().setStorage(storage);
```

## Examples

### Chat Application

```typescript
// Web chat application
app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  
  const response = await fred.processMessage(message, {
    conversationId: conversationId || fred.getContextManager().generateConversationId(),
  });
  
  res.json({ response, conversationId });
});
```

### Multi-User System

```typescript
// Different conversation per user
const userConversations = new Map();

function getConversationId(userId: string): string {
  if (!userConversations.has(userId)) {
    const contextManager = fred.getContextManager();
    userConversations.set(userId, contextManager.generateConversationId());
  }
  return userConversations.get(userId);
}
```

## Next Steps

- Learn about [Chat API](chat-api.md)
- Explore [Default Agent](default-agent.md)
- Check [API Reference](../api-reference/context.md)

