import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGoldenTrace, runTestCases, type TestCase } from '@fancyrobot/fred/eval';
import { Schema } from 'effect';
import {
  RefundDecisionSchema,
  RefundRequestSchema,
} from '../src/typed-agent';

describe('Golden trace evaluation', () => {
  test('billing routing and structured response assertions pass', async () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const tracesDirectory = join(currentDir, 'golden-traces');

    const cases: TestCase[] = [
      {
        name: 'Billing route',
        traceFile: 'sample.golden.json',
        assertions: [
          {
            type: 'routing',
            expected: {
              method: 'intent.matching',
              agentId: 'billing',
              intentId: 'billing.refund',
            },
          },
          {
            type: 'response',
            pathEquals: {
              'output.decision': 'approve',
              'output.refundAmount': 49,
              'output.currency': 'USD',
            },
            text: 'I can process your refund request right away.',
            semanticThreshold: 0.95,
          },
        ],
      },
    ];

    const results = await runTestCases(cases, tracesDirectory);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.results.every((result) => result.passed)).toBe(true);
  });

  test('golden input and output satisfy the agent Effect Schemas', async () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const trace = await loadGoldenTrace(
      join(currentDir, 'golden-traces', 'sample.golden.json'),
    );

    const input = Schema.decodeUnknownSync(
      Schema.parseJson(RefundRequestSchema),
    )(trace.trace.message);
    const output = Schema.decodeUnknownSync(RefundDecisionSchema)(
      trace.trace.response.output,
    );

    expect(input.subscriptionId).toBe('sub_pro_2026');
    expect(output).toEqual({
      decision: 'approve',
      refundAmount: 49,
      currency: 'USD',
      explanation: 'The renewal is eligible under the cancellation policy.',
    });
  });
});
