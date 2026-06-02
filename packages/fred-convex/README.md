# @fancyrobot/fred-convex

Convex integration helpers for the [Fred](https://github.com/fancyrobot/fred) AI framework.

## Overview

This package provides adapter glue for connecting Fred agents to a Convex backend. It follows the provider-style library pattern established by `@fancyrobot/fred-baml`: Fred owns the reusable adapter helpers while consuming apps own their Convex schema, generated `convex/_generated/api`, deployment URLs, auth, and concrete function references.

## Installation

```bash
bun add @fancyrobot/fred-convex
```

## Quick Start

```ts
import { initFredConvexRuntime, createConvexTool, callConvexQuery } from '@fancyrobot/fred-convex';

// Initialize runtime with your Convex deployment URL
const runtime = initFredConvexRuntime({
  url: process.env.CONVEX_URL!,
});

// Call a Convex function directly
const tasks = await callConvexQuery(runtime, 'api.tasks.list', {});

// Create a Fred tool backed by a Convex mutation
const createTaskTool = createConvexTool(runtime, {
  name: 'createTask',
  description: 'Create a new task in Convex',
  functionReference: 'api.tasks.create',
  functionType: 'mutation',
  parameters: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
});
```

## Testing

```ts
import { createStubConvexRuntime } from '@fancyrobot/fred-convex/testing';

const { runtime, client } = createStubConvexRuntime({
  'api.tasks.list': [{ _id: '1', title: 'Test task' }],
});
```

## API

- `initFredConvexRuntime(config)` — Initialize runtime with deployment URL and optional auth
- `callConvexQuery(runtime, fnRef, args?)` — Call a Convex query
- `callConvexMutation(runtime, fnRef, args?)` — Call a Convex mutation
- `callConvexAction(runtime, fnRef, args?)` — Call a Convex action
- `createConvexTool(runtime, options)` — Create a Fred tool backed by a Convex function
- `createStubConvexRuntime(responses?)` — Create deterministic test stub (from `/testing`)

## License

MIT
