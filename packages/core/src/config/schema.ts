/**
 * Effect Schema for Fred's framework config (Phase 61, STEP-61-02).
 *
 * `FrameworkConfigSchema` is the declarative replacement for the imperative
 * validation in `loader.ts`. This step models the structure and wires the
 * schema in as an accepted-parity validator; cross-field semantic rules
 * (required fields, policy XOR, reference integrity) land in STEP-61-03, and
 * `loader.ts` keeps owning validation until STEP-61-05 flips the decode path.
 *
 * Design notes:
 * - Config-owned sections (providers, MCP, persistence, observability,
 *   policies, template, memory, pipelinesV2) are modelled precisely against
 *   `types.ts`.
 * - Cross-module sections (agents, intents, pipelines, routing) are modelled
 *   as *open* structs — known identifying fields plus an index signature that
 *   preserves everything else — so decoding is lossless and every existing
 *   fixture is accepted. Their required-field rules are semantic and belong
 *   in STEP-61-03, not here (e.g. an agent may omit `systemMessage` when
 *   `defaultSystemMessage` is set).
 */
import { Schema } from 'effect';

/** An index signature that accepts and preserves arbitrary extra keys. */
const passthrough = Schema.Record({ key: Schema.String, value: Schema.Unknown });

/** `Record<string, string>` — used for headers/env maps. */
const StringRecord = Schema.Record({ key: Schema.String, value: Schema.String });

// ---------------------------------------------------------------------------
// Provider packs
// ---------------------------------------------------------------------------

export const ProviderModelDefaultsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
});

export const ProviderPackConfigSchema = Schema.Struct({
  id: Schema.String,
  package: Schema.optional(Schema.String),
  apiKeyEnvVar: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecord),
  modelDefaults: Schema.optional(ProviderModelDefaultsSchema),
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export const PluginObjectDeclarationSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  options: Schema.optional(passthrough),
});

export const PluginDeclarationSchema = Schema.Union(Schema.String, PluginObjectDeclarationSchema);

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export const MCPRetrySchema = Schema.Struct({
  maxRetries: Schema.optional(Schema.Number),
  backoffMs: Schema.optional(Schema.Number),
  maxBackoffMs: Schema.optional(Schema.Number),
});

export const MCPGlobalServerConfigSchema = Schema.Struct({
  transport: Schema.Literal('stdio', 'http', 'sse'),
  // stdio transport
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecord),
  allowedCommands: Schema.optional(Schema.Array(Schema.String)),
  envAllowlist: Schema.optional(Schema.Array(Schema.String)),
  // http/sse transport
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecord),
  allowedHosts: Schema.optional(Schema.Array(Schema.String)),
  allowedSchemes: Schema.optional(Schema.Array(Schema.String)),
  // common
  timeout: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
  lazy: Schema.optional(Schema.Boolean),
  retry: Schema.optional(MCPRetrySchema),
  healthCheckIntervalMs: Schema.optional(Schema.Number),
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const CheckpointConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  ttlMs: Schema.optional(Schema.Number),
  cleanupIntervalMs: Schema.optional(Schema.Number),
});

export const PersistenceConfigSchema = Schema.Struct({
  adapter: Schema.Literal('postgres', 'sqlite'),
  checkpoint: Schema.optional(CheckpointConfigSchema),
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export const ObservabilityConfigSchema = Schema.Struct({
  otlp: Schema.optional(
    Schema.Struct({
      endpoint: Schema.optional(Schema.String),
      headers: Schema.optional(StringRecord),
    }),
  ),
  logLevel: Schema.optional(
    Schema.Literal('trace', 'debug', 'info', 'warning', 'error', 'fatal'),
  ),
  // `resource` allows arbitrary extra attributes ([key: string]: unknown).
  resource: Schema.optional(
    Schema.Struct(
      {
        serviceName: Schema.optional(Schema.String),
        serviceVersion: Schema.optional(Schema.String),
        environment: Schema.optional(Schema.String),
      },
      passthrough,
    ),
  ),
  enableConsoleFallback: Schema.optional(Schema.Boolean),
  sampling: Schema.optional(
    Schema.Struct({
      successSampleRate: Schema.optional(Schema.Number),
      slowThresholdMs: Schema.optional(Schema.Number),
      debugMode: Schema.optional(Schema.Boolean),
    }),
  ),
  metrics: Schema.optional(
    Schema.Struct({
      pricing: Schema.optional(
        Schema.Record({
          key: Schema.String,
          value: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
        }),
      ),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Tool access policies
// ---------------------------------------------------------------------------

export const ToolPolicyConditionSchema = Schema.Struct({
  role: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
  userId: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
  metadata: Schema.optional(passthrough),
});

export const ToolPolicyRuleSchema = Schema.Struct({
  allow: Schema.optional(Schema.Array(Schema.String)),
  deny: Schema.optional(Schema.Array(Schema.String)),
  requireApproval: Schema.optional(Schema.Array(Schema.String)),
  requiredCategories: Schema.optional(Schema.Array(Schema.String)),
  conflictResolution: Schema.optional(Schema.Literal('deny-overrides', 'allow-overrides')),
  conditions: Schema.optional(ToolPolicyConditionSchema),
});

export const ToolPolicyOverrideSchema = Schema.Struct({
  ...ToolPolicyRuleSchema.fields,
  id: Schema.String,
  override: Schema.Literal(true),
  target: Schema.Struct({
    intentId: Schema.optional(Schema.String),
    agentId: Schema.optional(Schema.String),
  }),
});

export const ToolPoliciesConfigSchema = Schema.Struct({
  default: Schema.optional(ToolPolicyRuleSchema),
  intents: Schema.optional(Schema.Record({ key: Schema.String, value: ToolPolicyRuleSchema })),
  agents: Schema.optional(Schema.Record({ key: Schema.String, value: ToolPolicyRuleSchema })),
  overrides: Schema.optional(Schema.Array(ToolPolicyOverrideSchema)),
});

// ---------------------------------------------------------------------------
// Template + memory
// ---------------------------------------------------------------------------

export const TemplateConfigSchema = Schema.Struct({
  partialDirs: Schema.optional(Schema.Array(Schema.String)),
  envAllowlist: Schema.optional(Schema.Array(Schema.String)),
  strict: Schema.optional(Schema.Boolean),
  maxOutputSize: Schema.optional(Schema.Number),
});

export const MemoryConfigSchema = Schema.Struct({
  policy: Schema.optional(
    Schema.Struct({
      maxMessages: Schema.optional(Schema.Number),
      maxChars: Schema.optional(Schema.Number),
      strict: Schema.optional(Schema.Boolean),
      isolated: Schema.optional(Schema.Boolean),
    }),
  ),
  requireConversationId: Schema.optional(Schema.Boolean),
  sequentialVisibility: Schema.optional(Schema.Boolean),
});

// ---------------------------------------------------------------------------
// Pipeline V2 config steps (recursive: conditional steps nest steps)
// ---------------------------------------------------------------------------

/** Decoded shape of a config step; used to type the recursive `Schema.suspend`. */
export type ConfigStepShape =
  | ConfigAgentStepShape
  | ConfigFunctionRefStepShape
  | ConfigPipelineRefStepShape
  | ConfigConditionalStepShape;

interface ConfigStepBaseShape {
  readonly name: string;
  readonly retry?: {
    readonly maxRetries: number;
    readonly backoffMs: number;
    readonly maxBackoffMs?: number;
  };
  readonly contextView?: 'accumulated' | 'isolated';
}
interface ConfigAgentStepShape extends ConfigStepBaseShape {
  readonly type: 'agent';
  readonly agentId: string;
}
interface ConfigFunctionRefStepShape extends ConfigStepBaseShape {
  readonly type: 'function';
  readonly functionId: string;
}
interface ConfigPipelineRefStepShape extends ConfigStepBaseShape {
  readonly type: 'pipeline';
  readonly pipelineId: string;
}
interface ConfigConditionalStepShape extends ConfigStepBaseShape {
  readonly type: 'conditional';
  readonly condition: {
    readonly field: string;
    readonly equals?: unknown;
    readonly notEquals?: unknown;
    readonly exists?: boolean;
  };
  readonly whenTrue: ReadonlyArray<ConfigStepShape>;
  readonly whenFalse?: ReadonlyArray<ConfigStepShape>;
}

const ConfigStepBaseFields = {
  name: Schema.String,
  retry: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Number,
      backoffMs: Schema.Number,
      maxBackoffMs: Schema.optional(Schema.Number),
    }),
  ),
  contextView: Schema.optional(Schema.Literal('accumulated', 'isolated')),
};

const ConfigAgentStepSchema = Schema.Struct({
  ...ConfigStepBaseFields,
  type: Schema.Literal('agent'),
  agentId: Schema.String,
});
const ConfigFunctionRefStepSchema = Schema.Struct({
  ...ConfigStepBaseFields,
  type: Schema.Literal('function'),
  functionId: Schema.String,
});
const ConfigPipelineRefStepSchema = Schema.Struct({
  ...ConfigStepBaseFields,
  type: Schema.Literal('pipeline'),
  pipelineId: Schema.String,
});
const ConfigConditionalStepSchema = Schema.Struct({
  ...ConfigStepBaseFields,
  type: Schema.Literal('conditional'),
  condition: Schema.Struct({
    field: Schema.String,
    equals: Schema.optional(Schema.Unknown),
    notEquals: Schema.optional(Schema.Unknown),
    exists: Schema.optional(Schema.Boolean),
  }),
  whenTrue: Schema.Array(Schema.suspend((): Schema.Schema<ConfigStepShape> => ConfigStepSchema)),
  whenFalse: Schema.optional(
    Schema.Array(Schema.suspend((): Schema.Schema<ConfigStepShape> => ConfigStepSchema)),
  ),
});

export const ConfigStepSchema: Schema.Schema<ConfigStepShape> = Schema.Union(
  ConfigAgentStepSchema,
  ConfigFunctionRefStepSchema,
  ConfigPipelineRefStepSchema,
  ConfigConditionalStepSchema,
);

export const ExtendedPipelineConfigSchema = Schema.Struct({
  steps: Schema.Array(ConfigStepSchema),
  description: Schema.optional(Schema.String),
  utterances: Schema.optional(Schema.Array(Schema.String)),
  failFast: Schema.optional(Schema.Boolean),
});

// ---------------------------------------------------------------------------
// Tools (config-defined: schema metadata only)
// ---------------------------------------------------------------------------

export const ToolConfigSchema = Schema.Struct(
  {
    id: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    schema: Schema.optional(Schema.Struct({ metadata: Schema.optional(passthrough) }, passthrough)),
  },
  passthrough,
);

// ---------------------------------------------------------------------------
// Cross-module sections (open structs: known fields + preserved extras).
// Precise modelling and required-field rules land in later steps.
// ---------------------------------------------------------------------------

export const IntentConfigSchema = Schema.Struct(
  {
    id: Schema.optional(Schema.String),
    utterances: Schema.optional(Schema.Array(Schema.String)),
  },
  passthrough,
);

export const AgentPromptVariableSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
);

export const AgentTemplatePromptSchema = Schema.Struct({
  template: Schema.String,
  variables: Schema.optional(Schema.Record({
    key: Schema.String,
    value: AgentPromptVariableSchema,
  })),
  baml: Schema.optional(Schema.Never),
});

export const AgentBamlPromptSchema = Schema.Struct({
  baml: Schema.Struct({
    function: Schema.String,
  }),
  template: Schema.optional(Schema.Never),
  variables: Schema.optional(Schema.Never),
});

export const AgentPromptSchema = Schema.Union(
  Schema.String,
  AgentTemplatePromptSchema,
  AgentBamlPromptSchema,
);

export const AgentConfigSchema = Schema.Struct(
  {
    id: Schema.optional(Schema.String),
    platform: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    systemMessage: Schema.optional(AgentPromptSchema),
  },
  passthrough,
);

export const PipelineConfigSchema = Schema.Struct(
  {
    id: Schema.optional(Schema.String),
  },
  passthrough,
);

export const RoutingConfigSchema = Schema.Struct(
  {
    defaultAgent: Schema.optional(Schema.String),
    // `rules` is required: the legacy validator rejects a routing block without
    // it ("Routing rules must be an array"), and MessageRouterService spreads
    // `config.rules` at dispatch — an absent array crashes the router. An empty
    // list is valid (default-agent-only routing).
    rules: Schema.Array(Schema.Struct({}, passthrough)),
  },
  passthrough,
);

export const WorkflowConfigSchema = Schema.Struct({
  defaultAgent: Schema.String,
  agents: Schema.Array(Schema.String),
  routing: Schema.optional(RoutingConfigSchema),
});

// ---------------------------------------------------------------------------
// Top-level framework config
// ---------------------------------------------------------------------------

export const FrameworkConfigSchema = Schema.Struct({
  intents: Schema.optional(Schema.Array(IntentConfigSchema)),
  agents: Schema.optional(Schema.Array(AgentConfigSchema)),
  agentDirs: Schema.optional(Schema.Array(Schema.String)),
  pipelines: Schema.optional(Schema.Array(PipelineConfigSchema)),
  pipelinesV2: Schema.optional(
    Schema.Record({ key: Schema.String, value: ExtendedPipelineConfigSchema }),
  ),
  tools: Schema.optional(Schema.Array(ToolConfigSchema)),
  defaultSystemMessage: Schema.optional(Schema.String),
  memory: Schema.optional(MemoryConfigSchema),
  routing: Schema.optional(RoutingConfigSchema),
  workflows: Schema.optional(Schema.Record({ key: Schema.String, value: WorkflowConfigSchema })),
  providers: Schema.optional(Schema.Array(ProviderPackConfigSchema)),
  plugins: Schema.optional(Schema.Array(PluginDeclarationSchema)),
  persistence: Schema.optional(PersistenceConfigSchema),
  observability: Schema.optional(ObservabilityConfigSchema),
  policies: Schema.optional(ToolPoliciesConfigSchema),
  toolPolicies: Schema.optional(ToolPoliciesConfigSchema),
  mcpServers: Schema.optional(
    Schema.Record({ key: Schema.String, value: MCPGlobalServerConfigSchema }),
  ),
  template: Schema.optional(TemplateConfigSchema),
});

/** Decoded type of the framework config schema. */
export type FrameworkConfigSchemaType = Schema.Schema.Type<typeof FrameworkConfigSchema>;
