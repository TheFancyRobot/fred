# Context API

API reference for conversation context management.

## ContextManager

Manages conversation contexts and message history.

### Methods

#### generateConversationId()

Generate a unique conversation ID.

```typescript
const conversationId = contextManager.generateConversationId();
```

#### getContext()

Get or create a conversation context.

```typescript
const context = await contextManager.getContext(conversationId?: string): Promise<ConversationContext>
```

#### getContextById()

Get conversation context by ID.

```typescript
const context = await contextManager.getContextById(conversationId: string): Promise<ConversationContext | null>
```

#### addMessage()

Add a message to the conversation context.

```typescript
await contextManager.addMessage(conversationId: string, message: CoreMessage): Promise<void>
```

#### addMessages()

Add multiple messages to the conversation context.

```typescript
await contextManager.addMessages(conversationId: string, messages: CoreMessage[]): Promise<void>
```

#### getHistory()

Get conversation history.

```typescript
const history = await contextManager.getHistory(conversationId: string): Promise<CoreMessage[]>
```

#### updateMetadata()

Update conversation metadata.

```typescript
await contextManager.updateMetadata(
  conversationId: string,
  metadata: Partial<ConversationMetadata>
): Promise<void>
```

#### clearContext()

Clear conversation context.

```typescript
await contextManager.clearContext(conversationId: string): Promise<void>
```

#### clearAll()

Clear all conversation contexts.

```typescript
await contextManager.clearAll(): Promise<void>
```

#### setStorage()

Set custom storage implementation.

```typescript
contextManager.setStorage(storage: ContextStorage): void
```

## ConversationContext

```typescript
interface ConversationContext {
  id: string;
  messages: CoreMessage[];
  metadata: ConversationMetadata;
}
```

## ConversationMetadata

```typescript
interface ConversationMetadata {
  createdAt: Date;
  updatedAt: Date;
  [key: string]: any;
}
```

## ContextStorage

Interface for custom storage implementations.

```typescript
interface ContextStorage {
  get(id: string): Promise<ConversationContext | null>;
  set(id: string, context: ConversationContext): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
```

## Examples

### Getting Context Manager

```typescript
const contextManager = fred.getContextManager();
```

### Managing Conversation

```typescript
const conversationId = contextManager.generateConversationId();

// Add messages
await contextManager.addMessage(conversationId, {
  role: 'user',
  content: 'Hello!',
});

// Get history
const history = await contextManager.getHistory(conversationId);

// Update metadata
await contextManager.updateMetadata(conversationId, {
  userId: 'user123',
});

// Clear context
await contextManager.clearContext(conversationId);
```

### Custom Storage

```typescript
import { ContextStorage, ConversationContext } from 'fred';

class DatabaseStorage implements ContextStorage {
  async get(id: string): Promise<ConversationContext | null> {
    // Load from database
  }
  
  async set(id: string, context: ConversationContext): Promise<void> {
    // Save to database
  }
  
  async delete(id: string): Promise<void> {
    // Delete from database
  }
  
  async clear(): Promise<void> {
    // Clear all from database
  }
}

const storage = new DatabaseStorage();
const contextManager = fred.getContextManager();
contextManager.setStorage(storage);
```

