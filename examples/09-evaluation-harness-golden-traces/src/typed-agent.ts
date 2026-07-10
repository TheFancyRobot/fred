import type { AgentConfig } from '@fancyrobot/fred';
import { Schema } from 'effect';

export const RefundRequestSchema = Schema.Struct({
  customerId: Schema.String.pipe(Schema.minLength(1)),
  subscriptionId: Schema.String.pipe(Schema.minLength(1)),
  reason: Schema.String.pipe(Schema.minLength(1)),
});

export const RefundDecisionSchema = Schema.Struct({
  decision: Schema.Literal('approve', 'manual-review'),
  refundAmount: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0)),
  currency: Schema.Literal('USD'),
  explanation: Schema.String.pipe(Schema.minLength(1)),
});

export type RefundRequest = typeof RefundRequestSchema.Type;
export type RefundDecision = typeof RefundDecisionSchema.Type;

/**
 * Effect Schemas are runtime values, so typed agent I/O is configured in
 * TypeScript rather than YAML. The template prompt remains deterministic.
 */
export const billingAgentConfig = {
  id: 'billing',
  platform: 'openrouter',
  model: 'openrouter/free',
  systemMessage: {
    template: [
      'You are a billing specialist.',
      'Use a <%= vars.tone %> tone and policy version <%= vars.policyVersion %>.',
      'Return only the requested refund decision.',
    ].join('\n'),
    variables: {
      tone: 'clear',
      policyVersion: 3,
    },
  },
  input: RefundRequestSchema,
  output: RefundDecisionSchema,
  // One additional attempt, and only when structured output is malformed.
  outputRetry: { maxRetries: 1 },
  utterances: ['refund', 'subscription refund'],
} satisfies AgentConfig<typeof RefundRequestSchema, typeof RefundDecisionSchema>;
