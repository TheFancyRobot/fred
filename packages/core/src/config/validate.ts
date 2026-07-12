/**
 * Semantic (cross-field) config validation for Phase 61 (STEP-61-03).
 *
 * `FrameworkConfigSchema` (STEP-61-02) covers structure and types. The rules
 * here are the ones a structural schema can't express — required-when,
 * uniqueness, and reference integrity — ported from the imperative
 * `validateConfig` in `loader.ts` but returning `ConfigError`s (with
 * remediation) instead of throwing on the first problem.
 *
 * This function is not yet wired into `loadConfig`; STEP-61-05 makes the
 * loader run schema-decode + this pass and surface the aggregated errors.
 */
import { ConfigError } from './errors';
import type { FrameworkConfigSchemaType } from './schema';

const configError = (
  path: string,
  issue: string,
  remediation?: string,
  docsUrl?: string,
): ConfigError =>
  new ConfigError({
    path,
    issue,
    message: `${path}: ${issue}`,
    ...(remediation !== undefined ? { remediation } : {}),
    ...(docsUrl !== undefined ? { docsUrl } : {}),
  });

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const definedStrings = (values: ReadonlyArray<string | undefined>): Set<string> =>
  new Set(values.filter((v): v is string => Boolean(v)));

/** Tool ids present in both lists — an allow/deny or deny/approval conflict. */
const findConflicts = (
  first: ReadonlyArray<string> | undefined,
  second: ReadonlyArray<string> | undefined,
): string[] => {
  if (!first || !second || first.length === 0 || second.length === 0) return [];
  const inSecond = new Set(second);
  return first.filter((id) => inSecond.has(id));
};

/** Duplicate and unknown-tool checks for one allow/deny/requireApproval list. */
const policyToolRefErrors = (
  refs: ReadonlyArray<string> | undefined,
  path: string,
  label: string,
  toolIds: Set<string>,
): ConfigError[] => {
  if (!refs || refs.length === 0) return [];
  const out: ConfigError[] = [];
  const seen = new Set<string>();
  for (const toolId of refs) {
    if (seen.has(toolId)) {
      out.push(configError(path, `${label} contains duplicate tool reference "${toolId}"`, 'Remove the duplicate tool id.'));
    }
    seen.add(toolId);
    if (!toolIds.has(toolId)) {
      out.push(
        configError(path, `${label} references unknown tool "${toolId}"`, 'Reference a tool declared under `tools`, or remove it.'),
      );
    }
  }
  return out;
};

/**
 * Validate the contents of one tool-policy rule: unknown/duplicate tool refs in
 * allow/deny/requireApproval, and allow/deny + deny/requireApproval conflicts.
 * Mirrors the legacy `validatePolicyRule`.
 */
const policyRuleContentErrors = (
  rule:
    | { allow?: ReadonlyArray<string>; deny?: ReadonlyArray<string>; requireApproval?: ReadonlyArray<string> }
    | undefined,
  scopePath: string,
  label: string,
  toolIds: Set<string>,
): ConfigError[] => {
  if (!rule) return [];
  const out: ConfigError[] = [
    ...policyToolRefErrors(rule.allow, `${scopePath}.allow`, `${label} allow`, toolIds),
    ...policyToolRefErrors(rule.deny, `${scopePath}.deny`, `${label} deny`, toolIds),
    ...policyToolRefErrors(rule.requireApproval, `${scopePath}.requireApproval`, `${label} requireApproval`, toolIds),
  ];
  const allowDeny = findConflicts(rule.allow, rule.deny);
  if (allowDeny.length > 0) {
    out.push(
      configError(
        scopePath,
        `${label} has conflicting allow/deny declarations for tool(s): ${allowDeny.map((id) => `"${id}"`).join(', ')}`,
        'A tool cannot be both allowed and denied — remove it from one list.',
      ),
    );
  }
  const denyApproval = findConflicts(rule.deny, rule.requireApproval);
  if (denyApproval.length > 0) {
    out.push(
      configError(
        scopePath,
        `${label} has conflicting deny/requireApproval declarations for tool(s): ${denyApproval.map((id) => `"${id}"`).join(', ')}`,
        'A denied tool cannot also require approval — remove it from one list.',
      ),
    );
  }
  return out;
};

/**
 * Run every semantic rule over an already-structurally-decoded config and
 * return all violations. An empty array means the config is semantically
 * valid. Errors accumulate — every problem is reported, not just the first.
 */
export function validateFrameworkConfig(config: FrameworkConfigSchemaType): ConfigError[] {
  const errors: ConfigError[] = [];
  const hasDefaultSystemMessage = Boolean(config.defaultSystemMessage);

  // -- Intents ---------------------------------------------------------------
  config.intents?.forEach((intent, i) => {
    const base = `intents[${i}]`;
    const name = intent.id ?? '(unnamed)';
    if (!intent.id) {
      errors.push(configError(`${base}.id`, 'intent is missing an id', 'Add a unique `id` to the intent.'));
    }
    if (!intent.utterances || intent.utterances.length === 0) {
      errors.push(
        configError(
          `${base}.utterances`,
          `intent "${name}" must have at least one utterance`,
          'Add one or more example phrases under `utterances`.',
        ),
      );
    }
    const action = asRecord((intent as Record<string, unknown>).action);
    if (!action) {
      errors.push(
        configError(`${base}.action`, `intent "${name}" must have an action`, 'Add an `action` with a `type` and `target`.'),
      );
    } else if (!action.type || !action.target) {
      errors.push(
        configError(
          `${base}.action`,
          `intent "${name}" action must have type and target`,
          'Set both `action.type` and `action.target`.',
        ),
      );
    }
  });

  // -- Agents ----------------------------------------------------------------
  config.agents?.forEach((agent, i) => {
    const base = `agents[${i}]`;
    const name = agent.id ?? '(unnamed)';
    if (!agent.id) {
      errors.push(configError(`${base}.id`, 'agent is missing an id', 'Add a unique `id` to the agent.'));
    }
    if (!agent.systemMessage && !hasDefaultSystemMessage) {
      errors.push(
        configError(
          `${base}.systemMessage`,
          `agent "${name}" must have a systemMessage or defaultSystemMessage must be configured`,
          'Add `systemMessage` to the agent, or set a top-level `defaultSystemMessage`.',
        ),
      );
    }
    if (!agent.platform) {
      errors.push(
        configError(`${base}.platform`, `agent "${name}" must have a platform`, 'Set `platform` (e.g. openai, anthropic).'),
      );
    }
    if (!agent.model) {
      errors.push(configError(`${base}.model`, `agent "${name}" must have a model`, 'Set `model` (e.g. gpt-4).'));
    }
  });

  // -- Tools -----------------------------------------------------------------
  config.tools?.forEach((tool, i) => {
    const base = `tools[${i}]`;
    const name = tool.id ?? '(unnamed)';
    if (!tool.id) {
      errors.push(configError(`${base}.id`, 'tool is missing an id', 'Add a unique `id` to the tool.'));
    }
    if (!tool.name) {
      errors.push(configError(`${base}.name`, `tool "${name}" must have a name`, 'Add a human-readable `name`.'));
    }
    if (!tool.description) {
      errors.push(
        configError(`${base}.description`, `tool "${name}" must have a description`, 'Add a `description` of what the tool does.'),
      );
    }
    const metadata = asRecord(tool.schema?.metadata);
    const strict = Boolean((tool as Record<string, unknown>).strict);
    if (strict && !metadata) {
      errors.push(
        configError(
          `${base}.schema.metadata`,
          `tool "${name}" requires schema metadata when strict mode is enabled`,
          'Provide `schema.metadata`, or remove `strict: true`.',
        ),
      );
    }
    if (metadata) {
      if (metadata.type !== 'object') {
        errors.push(
          configError(
            `${base}.schema.metadata.type`,
            `tool "${name}" schema metadata must be type "object"`,
            'Set `schema.metadata.type` to "object".',
          ),
        );
      }
      if (!metadata.properties || typeof metadata.properties !== 'object') {
        errors.push(
          configError(
            `${base}.schema.metadata.properties`,
            `tool "${name}" schema metadata must include properties`,
            'Add a `properties` object to `schema.metadata`.',
          ),
        );
      }
    }
  });

  // -- Routing rules ---------------------------------------------------------
  config.routing?.rules?.forEach((rule, i) => {
    const r = rule as Record<string, unknown>;
    const base = `routing.rules[${i}]`;
    const name = (r.id as string | undefined) ?? `(index ${i})`;
    if (!r.id) {
      errors.push(configError(`${base}.id`, 'routing rule is missing an id', 'Add an `id` to the routing rule.'));
    }
    if (!r.agent) {
      errors.push(
        configError(`${base}.agent`, `routing rule "${name}" must reference an agent`, 'Set `agent` to a defined agent id.'),
      );
    }
  });

  // -- Workflows -------------------------------------------------------------
  if (config.workflows) {
    for (const [workflowName, workflow] of Object.entries(config.workflows)) {
      if (workflow.agents.length === 0) {
        errors.push(
          configError(
            `workflows.${workflowName}.agents`,
            `workflow "${workflowName}" must have at least one agent`,
            'List one or more agent ids under `agents`.',
          ),
        );
      }
    }
  }

  // -- Tool policies ---------------------------------------------------------
  if (config.policies && config.toolPolicies) {
    errors.push(
      configError(
        'toolPolicies',
        'config defines both "policies" and "toolPolicies"',
        'Use only one policy section — prefer `policies` and remove `toolPolicies`.',
      ),
    );
  }
  const policies = config.policies ?? config.toolPolicies;
  if (policies) {
    const policyKey = config.policies ? 'policies' : 'toolPolicies';
    const intentIds = definedStrings((config.intents ?? []).map((intent) => intent.id));
    const agentIds = definedStrings((config.agents ?? []).map((agent) => agent.id));
    const toolIds = definedStrings((config.tools ?? []).map((tool) => tool.id));

    // Default rule contents (unknown/duplicate tool refs, allow/deny conflicts).
    errors.push(
      ...policyRuleContentErrors(policies.default, `${policyKey}.default`, 'default tool policy', toolIds),
    );

    for (const [intentId, rule] of Object.entries(policies.intents ?? {})) {
      if (!intentIds.has(intentId)) {
        errors.push(
          configError(
            `${policyKey}.intents.${intentId}`,
            `tool policy references unknown intent "${intentId}"`,
            'Reference an intent declared under `intents`, or remove this policy.',
          ),
        );
      }
      errors.push(
        ...policyRuleContentErrors(rule, `${policyKey}.intents.${intentId}`, `tool policy for intent "${intentId}"`, toolIds),
      );
    }
    for (const [agentId, rule] of Object.entries(policies.agents ?? {})) {
      if (!agentIds.has(agentId)) {
        errors.push(
          configError(
            `${policyKey}.agents.${agentId}`,
            `tool policy references unknown agent "${agentId}"`,
            'Reference an agent declared under `agents`, or remove this policy.',
          ),
        );
      }
      errors.push(
        ...policyRuleContentErrors(rule, `${policyKey}.agents.${agentId}`, `tool policy for agent "${agentId}"`, toolIds),
      );
    }

    const seenOverrideIds = new Set<string>();
    (policies.overrides ?? []).forEach((override, i) => {
      const base = `${policyKey}.overrides[${i}]`;
      if (seenOverrideIds.has(override.id)) {
        errors.push(
          configError(`${base}.id`, `duplicate tool policy override id "${override.id}"`, 'Give each override a unique `id`.'),
        );
      }
      seenOverrideIds.add(override.id);

      if (!override.target || (!override.target.intentId && !override.target.agentId)) {
        errors.push(
          configError(
            `${base}.target`,
            `override "${override.id}" must declare a target scope (intentId and/or agentId)`,
            'Set `target.intentId` and/or `target.agentId`.',
          ),
        );
      }
      if (override.target?.intentId && !intentIds.has(override.target.intentId)) {
        errors.push(
          configError(
            `${base}.target.intentId`,
            `override "${override.id}" references unknown intent "${override.target.intentId}"`,
            'Reference an intent declared under `intents`.',
          ),
        );
      }
      if (override.target?.agentId && !agentIds.has(override.target.agentId)) {
        errors.push(
          configError(
            `${base}.target.agentId`,
            `override "${override.id}" references unknown agent "${override.target.agentId}"`,
            'Reference an agent declared under `agents`.',
          ),
        );
      }
      errors.push(...policyRuleContentErrors(override, base, `override "${override.id}"`, toolIds));
    });
  }

  return errors;
}
