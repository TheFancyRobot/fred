# Tools API

API reference for tool configuration and management.

## Tool

```typescript
interface Tool {
  id: string;                    // Unique tool identifier
  name: string;                  // Tool name
  description: string;            // Description for the AI
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  execute: (args: Record<string, any>) => Promise<any> | any;
}
```

## ToolParameter

```typescript
interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: (string | number)[];
  properties?: Record<string, ToolParameter>; // For object types
  items?: ToolParameter;                    // For array types
}
```

## Examples

### Creating a Tool

```typescript
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Operation to perform',
        enum: ['add', 'subtract', 'multiply', 'divide'],
      },
      a: {
        type: 'number',
        description: 'First number',
      },
      b: {
        type: 'number',
        description: 'Second number',
      },
    },
    required: ['operation', 'a', 'b'],
  },
  execute: async (args) => {
    const { operation, a, b } = args;
    switch (operation) {
      case 'add': return a + b;
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return b !== 0 ? a / b : 'Error: Division by zero';
    }
  },
});
```

### Getting a Tool

```typescript
const tool = fred.getTool('calculator');
if (tool) {
  console.log(tool.description);
}
```

### Getting All Tools

```typescript
const tools = fred.getTools();
console.log(tools); // Array of all registered tools
```

### Tool with Complex Parameters

```typescript
fred.registerTool({
  id: 'complex-tool',
  name: 'complex-tool',
  description: 'Tool with complex parameters',
  parameters: {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        description: 'User information',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      },
      tags: {
        type: 'array',
        description: 'List of tags',
        items: { type: 'string' },
      },
    },
    required: ['user'],
  },
  execute: async (args) => {
    // Implementation
  },
});
```

