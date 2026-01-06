# Custom Tools

Learn how to create advanced custom tools for Fred.

## Advanced Tool Example

```typescript
fred.registerTool({
  id: 'database-query',
  name: 'database-query',
  description: 'Query the database',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      params: { type: 'object' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    // Database query implementation
    const results = await db.query(args.query, args.params);
    return results;
  },
});
```

## Tool with Authentication

```typescript
fred.registerTool({
  id: 'authenticated-api',
  name: 'authenticated-api',
  description: 'Call authenticated API',
  parameters: {
    type: 'object',
    properties: {
      endpoint: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
    },
    required: ['endpoint'],
  },
  execute: async (args) => {
    const response = await fetch(args.endpoint, {
      method: args.method || 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`,
      },
    });
    return await response.json();
  },
});
```

