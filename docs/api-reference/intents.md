# Intents API

API reference for intent configuration and matching.

## Intent

```typescript
interface Intent {
  id: string;                    // Unique intent identifier
  utterances: string[];          // Phrases that trigger this intent
  action: Action;                // Action to execute when matched
  description?: string;          // Optional description
}
```

## Action

```typescript
interface Action {
  type: 'agent' | 'function';   // Action type
  target: string;                // Agent ID or function name
  payload?: Record<string, any>; // Optional payload
}
```

## IntentMatch

```typescript
interface IntentMatch {
  intent: Intent;
  confidence: number;            // Match confidence (0-1)
  matchedUtterance?: string;    // The utterance that matched
  matchType: 'exact' | 'regex' | 'semantic'; // Match type
}
```

## Examples

### Creating an Intent

```typescript
fred.registerIntent({
  id: 'greeting',
  utterances: ['hello', 'hi', 'hey'],
  action: {
    type: 'agent',
    target: 'greeting-agent',
  },
  description: 'Handles greeting messages',
});
```

### Intent with Payload

```typescript
fred.registerIntent({
  id: 'custom',
  utterances: ['custom action'],
  action: {
    type: 'agent',
    target: 'agent-id',
    payload: {
      customData: 'value',
    },
  },
});
```

### Multiple Intents

```typescript
fred.registerIntents([
  {
    id: 'greeting',
    utterances: ['hello', 'hi'],
    action: { type: 'agent', target: 'greeting-agent' },
  },
  {
    id: 'math',
    utterances: ['calculate', 'math'],
    action: { type: 'agent', target: 'math-agent' },
  },
]);
```

### Getting Intents

```typescript
const intents = fred.getIntents();
console.log(intents); // Array of all registered intents
```

