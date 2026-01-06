# Chat API

Fred provides an OpenAI-compatible chat API that works with standard AI chat tools like Misty, Chatbox, and other OpenAI-compatible applications.

## Endpoints

### POST /v1/chat/completions

OpenAI-compatible endpoint for chat completions.

**Request:**

```json
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "conversation_id": "optional-conversation-id",
  "stream": false
}
```

**Response:**

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "fred-agent",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### POST /chat

Simplified chat endpoint.

**Request:**

```json
{
  "message": "Hello!",
  "conversation_id": "optional-conversation-id"
}
```

**Response:**

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "fred-agent",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ]
}
```

## Streaming

Enable streaming for real-time responses:

```json
{
  "messages": [
    { "role": "user", "content": "Tell me a story" }
  ],
  "stream": true
}
```

Response is sent as Server-Sent Events (SSE):

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk",...}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk",...}
```

## Using with Chat Tools

### Misty

Configure Misty to use Fred's endpoint:

```
API Endpoint: http://localhost:3000/v1/chat/completions
API Key: (not required, but can be configured)
```

### Chatbox

In Chatbox settings:

```
Custom API: http://localhost:3000/v1/chat/completions
Model: fred-agent
```

### curl Example

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

## Conversation Context

Maintain context across requests:

```bash
# First message
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "My name is Alice" }
    ],
    "conversation_id": "conv-123"
  }'

# Follow-up message
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "What is my name?" }
    ],
    "conversation_id": "conv-123"
  }'
```

## Message Format

Messages follow OpenAI's format:

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}
```

## Intent Routing

The chat API automatically routes messages based on intents:

```typescript
// Setup
fred.registerIntent({
  id: 'math',
  utterances: ['calculate', 'math'],
  action: { type: 'agent', target: 'math-agent' },
});

// Chat request
{
  "messages": [
    { "role": "user", "content": "Calculate 5 + 3" }
  ]
}
// Automatically routes to math-agent
```

## Error Handling

The API returns standard error responses:

```json
{
  "error": {
    "message": "No default agent configured",
    "type": "invalid_request_error"
  }
}
```

## CORS

CORS is enabled by default for chat tools. For production, configure allowed origins:

```typescript
// In server configuration
const app = new ServerApp(fred);
// CORS headers are automatically added
```

## Examples

### JavaScript Client

```javascript
async function chat(message, conversationId) {
  const response = await fetch('http://localhost:3000/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      conversation_id: conversationId,
    }),
  });
  
  const data = await response.json();
  return data.choices[0].message.content;
}
```

### Python Client

```python
import requests

def chat(message, conversation_id=None):
    response = requests.post(
        'http://localhost:3000/v1/chat/completions',
        json={
            'messages': [{'role': 'user', 'content': message}],
            'conversation_id': conversation_id,
        }
    )
    return response.json()['choices'][0]['message']['content']
```

## Next Steps

- Learn about [Context Management](context-management.md)
- Explore [Server Mode](../examples/server-mode.md)
- Check [API Reference](../api-reference/fred-class.md)

