# @fancyrobot/fred-convex

Convex integration helpers for the [Fred](https://github.com/fancyrobot/fred) AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core,
Effect, and Convex peer lines.

## Overview

This package provides adapter glue for connecting Fred agents to a Convex backend. It follows the provider-style library pattern established by `@fancyrobot/fred-baml`: Fred owns the reusable adapter helpers while consuming apps own their Convex schema, generated `convex/_generated/api`, deployment URLs, auth, and concrete function references.

## Installation

```bash
bun add --exact @fancyrobot/fred-convex@1.0.0-alpha.1 \
  @fancyrobot/fred@2.0.0-alpha.1 convex@^1.0.0 effect@^3.21.0
```

## Quick Start

```ts
import { Schema } from 'effect';
import {
  initFredConvexRuntime,
  createConvexTool,
  callConvexQuery,
} from '@fancyrobot/fred-convex';

const runtime = initFredConvexRuntime({
  config: { url: process.env.CONVEX_URL! },
  loadClient: async () => {
    const { ConvexHttpClient } = await import('convex/browser');
    const client = new ConvexHttpClient(process.env.CONVEX_URL!);

    if (process.env.CONVEX_AUTH_TOKEN) {
      client.setAuth(process.env.CONVEX_AUTH_TOKEN);
    }

    return client;
  },
});

const tasks = await callConvexQuery(runtime, 'api/tasks:list', {});
// In a real Convex app you can also pass generated references like `api.tasks.list`.

const createTaskTool = createConvexTool({
  id: 'convex.createTask',
  description: 'Create a new task in Convex',
  functionReference: 'api/tasks:create',
  functionType: 'mutation',
  inputSchema: Schema.Struct({ title: Schema.String }),
  successSchema: Schema.Struct({ _id: Schema.String }),
  runtime,
});
```

## Testing

```ts
import { createStubConvexRuntime } from '@fancyrobot/fred-convex/testing';

const { runtime, client } = createStubConvexRuntime({
  query: {
    'api/tasks:list': [{ _id: '1', title: 'Test task' }],
  },
});
```

## API

- `initFredConvexRuntime({ config, loadClient? })` — initialize a runtime with deployment config and an optional async client loader
- `callConvexQuery(runtime, fnRef, args?)` — call a Convex query
- `callConvexMutation(runtime, fnRef, args?)` — call a Convex mutation
- `callConvexAction(runtime, fnRef, args?)` — call a Convex action
- `createConvexTool({ id, description, functionReference, functionType, inputSchema, successSchema, runtime, ... })` — create a Fred tool backed by a Convex function
- `createStubConvexRuntime(responses?)` — create a deterministic test stub (from `/testing`)

## License

MIT
