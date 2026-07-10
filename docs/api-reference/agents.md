# Agents API

API reference for agent configuration and management.

## AgentConfig

```typescript
interface AgentConfig<InputSchema, OutputSchema> {
  id: string;                    // Unique agent identifier
  systemMessage?:
    | string
    | { template: string; variables: Record<string, string | number | boolean> }
    | { baml: { function: string } };
  platform: AIPlatform;          // AI platform ('openai', 'groq', etc.)
  model: string;                 // Model identifier
  tools?: string[];              // Array of tool IDs
  utterances?: string[];         // Phrases for direct routing (bypasses intents)
  temperature?: number;          // Temperature (0-1)
  maxTokens?: number;            // Maximum tokens
  maxSteps?: number;             // Maximum tool loop steps (default: 20)
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool'; toolName: string }; // Tool usage control
  mcpServers?: MCPServerConfig[]; // MCP servers to connect to
  input?: InputSchema;           // Programmatic Effect Schema
  output?: OutputSchema;         // Programmatic Effect Schema
  outputRetry?: {
    maxRetries?: number;         // Additional malformed-output attempts (default: 1)
  };
}
```

`input` and `output` accept Effect Schema values and therefore are available to
programmatic TypeScript configuration only. They are not YAML/JSON fields.
`output` must encode to an object schema; scalar and array roots are rejected
when the agent is created.
`outputRetry.maxRetries` counts additional attempts and applies only to
`MalformedOutput`; provider, network, and tool failures are not retried by this
setting.

**Note**: Fred uses AI SDK v6's `ToolLoopAgent` internally, which automatically handles tool execution loops. The `maxSteps` option controls how many steps the agent can take (each step is one generation: text or tool call). The `toolChoice` option controls how the agent uses available tools.

## MCPServerConfig

```typescript
interface MCPServerConfig {
  id: string;                    // Unique identifier for this MCP server
  name?: string;                 // Optional display name
  transport: 'stdio' | 'http' | 'sse';
  
  // For stdio transport
  command?: string;              // Command to run (e.g., 'npx', 'node')
  args?: string[];               // Arguments
  env?: Record<string, string>;  // Environment variables
  
  // For HTTP/SSE transport
  url?: string;                  // Server URL
  headers?: Record<string, string>; // Optional headers
  
  // Optional configuration
  enabled?: boolean;             // Enable/disable (default: true)
  timeout?: number;              // Connection timeout in ms (default: 30000)
}
```

## AgentInstance

```typescript
interface AgentInstance<InputSchema, OutputSchema> {
  id: string;
  config: AgentConfig<InputSchema, OutputSchema>;
  run: (
    input: Schema.Type<InputSchema>,
    messages?: AgentMessage[]
  ) => Effect.Effect<AgentResponse<Schema.Type<OutputSchema>>, Error>;
  processMessage: (
    message: string,
    messages?: AgentMessage[]
  ) => Effect.Effect<AgentResponse<Schema.Type<OutputSchema>>, Error>;
}
```

## AgentMessage

```typescript
interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
```

## AgentResponse

```typescript
interface AgentResponse<Output = unknown> {
  content: string;
  output?: Output;               // Decoded value for schema-backed agents
  toolCalls?: Array<{
    toolId: string;
    args: Record<string, any>;
    result?: any;
  }>;
  handoff?: {
    type: 'handoff';
    agentId: string;
    message: string;
    context?: Record<string, any>;
  };
}
```

Schema-backed agents validate the complete object before returning. Routed
streaming uses validated synthetic events for these agents; the decoded value
is available on the final `run-end.result.output`, not as incremental JSON
tokens.

## AIPlatform

Supported platform types:

```typescript
type AIPlatform = 
  | 'openai' 
  | 'groq' 
  | 'anthropic' 
  | 'google' 
  | 'mistral' 
  | 'cohere' 
  | 'vercel' 
  | 'azure-openai' 
  | 'azure-anthropic' 
  | 'azure'
  | 'fireworks' 
  | 'xai' 
  | 'ollama' 
  | 'ai21' 
  | 'nvidia' 
  | 'bedrock' 
  | 'amazon-bedrock' 
  | 'cloudflare' 
  | 'elevenlabs' 
  | 'lepton' 
  | 'perplexity' 
  | 'replicate' 
  | 'together' 
  | 'upstash'
  | string;
```

## Examples

### Creating an Agent

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
  temperature: 0.7,
  maxTokens: 2000,
});
```

### Using an Agent

```typescript
import { Effect } from 'effect';

const agent = fred.getAgent('my-agent');
if (agent) {
  const response = await Effect.runPromise(agent.processMessage('Hello!'));
  console.log(response.content);
}
```

### Agent with Tools

```typescript
// Register tools first
fred.registerTool({ id: 'tool1', /* ... */ });
fred.registerTool({ id: 'tool2', /* ... */ });

// Create agent with tools
await fred.createAgent({
  id: 'agent',
  systemMessage: 'You can use tools.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['tool1', 'tool2'],
});
```
